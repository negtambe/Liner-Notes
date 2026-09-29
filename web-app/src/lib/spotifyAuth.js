// Spotify Authorization Code with PKCE — no client secret needed, safe for a
// static/client-only deploy. See:
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI;
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

const VERIFIER_KEY = "linernotes.spotify.verifier";
const TOKEN_KEY = "linernotes.spotify.token"; // { access_token, refresh_token, expires_at }

function base64UrlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomVerifier(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

async function challengeFromVerifier(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

export function isConfigured() {
  return Boolean(CLIENT_ID && REDIRECT_URI);
}

export function getStoredToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    /* ignore */
  }
}

export function logout() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(VERIFIER_KEY);
  } catch {
    /* ignore */
  }
}

export async function login() {
  const verifier = randomVerifier();
  try {
    localStorage.setItem(VERIFIER_KEY, verifier);
  } catch {
    /* ignore */
  }
  const challenge = await challengeFromVerifier(verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

// Call once on app load. If the URL has a Spotify ?code=..., exchanges it for
// a token, stores it, and strips the query string. Returns true if a redirect
// was handled.
export async function handleRedirectCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    window.history.replaceState({}, "", url.pathname);
    throw new Error(`Spotify authorization failed: ${error}`);
  }
  if (!code) return false;

  let verifier;
  try {
    verifier = localStorage.getItem(VERIFIER_KEY);
  } catch {
    verifier = null;
  }
  if (!verifier) return false;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    window.history.replaceState({}, "", url.pathname);
    throw new Error(`Spotify token exchange failed: ${res.status}`);
  }
  const json = await res.json();
  storeToken({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  });
  window.history.replaceState({}, "", url.pathname);
  return true;
}

async function refreshToken(refresh_token) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Spotify token refresh failed: ${res.status}`);
  const json = await res.json();
  const next = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  storeToken(next);
  return next;
}

// Returns a currently-valid access token, refreshing if needed. Returns null
// if the user isn't logged in.
export async function getValidAccessToken() {
  let token = getStoredToken();
  if (!token) return null;
  if (Date.now() > token.expires_at - 30000) {
    if (!token.refresh_token) return null;
    token = await refreshToken(token.refresh_token);
  }
  return token.access_token;
}

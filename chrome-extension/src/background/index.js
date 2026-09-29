// Background service worker: owns the Spotify OAuth session and proxies all
// Web API calls, since the MV3 background context isn't subject to
// open.spotify.com's own CSP the way our injected scripts are.

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

function redirectUri() {
  return `https://${chrome.runtime.id}.chromiumapp.org/`;
}

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

async function getToken() {
  const { spotifyToken } = await chrome.storage.local.get("spotifyToken");
  return spotifyToken || null;
}

async function setToken(token) {
  await chrome.storage.local.set({ spotifyToken: token });
}

async function login() {
  const verifier = randomVerifier();
  const challenge = await challengeFromVerifier(verifier);
  const redirect = redirectUri();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirect,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const url = new URL(responseUrl);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) throw new Error(`Spotify authorization failed: ${error}`);
  if (!code) throw new Error("No authorization code returned.");

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Spotify token exchange failed: ${res.status}`);
  const json = await res.json();
  const token = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  await setToken(token);
  return true;
}

async function refresh(token) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
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
    refresh_token: json.refresh_token || token.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  await setToken(next);
  return next;
}

async function getValidAccessToken() {
  let token = await getToken();
  if (!token) return null;
  if (Date.now() > token.expires_at - 30000) {
    if (!token.refresh_token) return null;
    token = await refresh(token);
  }
  return token.access_token;
}

async function apiFetch(path, opts = {}) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not logged in to Spotify.");
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spotify API ${path} failed: ${res.status} ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function searchTracks(query) {
  const json = await apiFetch(`/search?${new URLSearchParams({ q: query, type: "track", limit: "8" })}`);
  return (json.tracks?.items || []).map((t) => ({
    id: t.id,
    uri: t.uri,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    durationMs: t.duration_ms,
  }));
}

async function getTrack(id) {
  const t = await apiFetch(`/tracks/${id}`);
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    durationMs: t.duration_ms,
  };
}

async function getPlaylistTracks(playlistId) {
  let path = `/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,uri,name,duration_ms,artists(name)))`;
  const out = [];
  while (path) {
    const json = await apiFetch(path);
    for (const item of json.items || []) {
      const t = item.track;
      if (!t || !t.id) continue;
      out.push({
        id: t.id,
        uri: t.uri,
        name: t.name,
        artist: (t.artists || []).map((a) => a.name).join(", "),
        durationMs: t.duration_ms,
      });
    }
    path = json.next ? json.next.replace("https://api.spotify.com/v1", "") : null;
  }
  return out;
}

async function playOnDevice(deviceId, uri) {
  await apiFetch(`/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    body: JSON.stringify({ uris: [uri] }),
  });
  return true;
}

async function fetchSdkScript() {
  const res = await fetch("https://sdk.scdn.co/spotify-player.js");
  if (!res.ok) throw new Error(`Fetching Spotify SDK failed: ${res.status}`);
  return res.text();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "FETCH_SDK_SCRIPT":
          sendResponse({ ok: true, code: await fetchSdkScript() });
          break;
        case "LOGIN":
          await login();
          sendResponse({ ok: true });
          break;
        case "LOGOUT":
          await chrome.storage.local.remove("spotifyToken");
          sendResponse({ ok: true });
          break;
        case "GET_LOGIN_STATE":
          sendResponse({ ok: true, loggedIn: Boolean(await getToken()) });
          break;
        case "GET_TOKEN":
          sendResponse({ ok: true, token: await getValidAccessToken() });
          break;
        case "SEARCH_TRACKS":
          sendResponse({ ok: true, results: await searchTracks(msg.query) });
          break;
        case "GET_TRACK":
          sendResponse({ ok: true, track: await getTrack(msg.id) });
          break;
        case "GET_PLAYLIST_TRACKS":
          sendResponse({ ok: true, tracks: await getPlaylistTracks(msg.playlistId) });
          break;
        case "PLAY_ON_DEVICE":
          await playOnDevice(msg.deviceId, msg.uri);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: "Unknown message type: " + msg?.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true; // keep the message channel open for the async response
});

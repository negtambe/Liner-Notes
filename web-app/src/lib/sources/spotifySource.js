// Spotify Web Playback SDK source. Requires Premium (Spotify won't stream
// full tracks to a Web Playback SDK device otherwise) and a valid OAuth
// access token from spotifyAuth.js (Authorization Code + PKCE).
// Docs: https://developer.spotify.com/documentation/web-playback-sdk

import { getValidAccessToken } from "../spotifyAuth";

let sdkReadyPromise = null;
let playerSingleton = null; // { player, deviceId }

function loadSdk() {
  if (window.Spotify) return Promise.resolve();
  if (sdkReadyPromise) return sdkReadyPromise;
  sdkReadyPromise = new Promise((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const tag = document.createElement("script");
    tag.src = "https://sdk.scdn.co/spotify-player.js";
    document.head.appendChild(tag);
  });
  return sdkReadyPromise;
}

// One Player/device per page load — Spotify only lets a device belong to one
// active connection at a time anyway.
export async function ensurePlayer() {
  if (playerSingleton) return playerSingleton;
  await loadSdk();

  const player = new window.Spotify.Player({
    name: "Liner Notes",
    getOAuthToken: async (cb) => {
      const token = await getValidAccessToken();
      cb(token);
    },
    volume: 0.8,
  });

  const deviceId = await new Promise((resolve, reject) => {
    player.addListener("ready", ({ device_id }) => resolve(device_id));
    player.addListener("initialization_error", ({ message }) => reject(new Error(message)));
    player.addListener("authentication_error", ({ message }) => reject(new Error(message)));
    player.addListener("account_error", ({ message }) =>
      reject(new Error(message + " (Spotify Premium is required for Web Playback.)"))
    );
    player.connect();
  });

  playerSingleton = { player, deviceId };
  return playerSingleton;
}

export function extractSpotifyTrackId(input) {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed;
  const uriMatch = trimmed.match(/^spotify:track:([a-zA-Z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];
  try {
    const url = new URL(trimmed);
    const pathMatch = url.pathname.match(/\/track\/([a-zA-Z0-9]{22})/);
    if (pathMatch) return pathMatch[1];
  } catch {
    /* not a URL */
  }
  return null;
}

export async function getTrack(id) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not logged in to Spotify.");
  const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify lookup failed: ${res.status}`);
  const t = await res.json();
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    durationMs: t.duration_ms,
  };
}

export function extractSpotifyPlaylistId(input) {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed;
  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];
  try {
    const url = new URL(trimmed);
    const pathMatch = url.pathname.match(/\/playlist\/([a-zA-Z0-9]{22})/);
    if (pathMatch) return pathMatch[1];
  } catch {
    /* not a URL */
  }
  return null;
}

// Fetches every track in a playlist (paginating past Spotify's 100-per-page
// cap) using the same token from login — no separate playlist permission or
// extra setup needed.
export async function getPlaylistTracks(playlistId) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not logged in to Spotify.");
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,uri,name,duration_ms,artists(name)))`;
  const out = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Spotify playlist lookup failed: ${res.status}`);
    const json = await res.json();
    for (const item of json.items || []) {
      const t = item.track;
      if (!t || !t.id) continue; // local files / removed tracks come back null
      out.push({
        id: t.id,
        uri: t.uri,
        name: t.name,
        artist: (t.artists || []).map((a) => a.name).join(", "),
        durationMs: t.duration_ms,
      });
    }
    url = json.next || null;
  }
  return out;
}

export async function searchTracks(query) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not logged in to Spotify.");
  const params = new URLSearchParams({ q: query, type: "track", limit: "8" });
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
  const json = await res.json();
  return (json.tracks?.items || []).map((t) => ({
    id: t.id,
    uri: t.uri,
    name: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    durationMs: t.duration_ms,
  }));
}

async function playTrackUri(deviceId, uri) {
  const token = await getValidAccessToken();
  const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uris: [uri] }),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`Spotify playback failed: ${res.status} ${body}`);
  }
}

// trackMeta: { uri, durationMs } — durationMs from search results lets the
// Deck show a duration before the SDK's first state-changed event arrives.
export async function createSpotifySource(trackMeta) {
  const { player, deviceId } = await ensurePlayer();

  const timeSubs = new Set();
  const playSubs = new Set();

  let durationMs = trackMeta.durationMs || 0;
  let positionMs = 0;
  let isPaused = true;
  let lastUpdateAt = Date.now();
  let pollTimer = null;

  function onStateChanged(state) {
    if (!state) return;
    // Ignore state events for a different track (another device/app took over).
    if (state.track_window?.current_track?.uri && state.track_window.current_track.uri !== trackMeta.uri) return;
    durationMs = state.duration || durationMs;
    positionMs = state.position || 0;
    lastUpdateAt = Date.now();
    const wasPaused = isPaused;
    isPaused = state.paused;
    if (wasPaused !== isPaused) {
      for (const cb of playSubs) cb(!isPaused);
    }
  }
  player.addListener("player_state_changed", onStateChanged);

  await playTrackUri(deviceId, trackMeta.uri);

  pollTimer = setInterval(() => {
    const estMs = isPaused ? positionMs : positionMs + (Date.now() - lastUpdateAt);
    for (const cb of timeSubs) cb(estMs / 1000);
  }, 200);

  return {
    kind: "spotify",
    hasWaveform: false,
    ready: Promise.resolve(),
    play: () => player.resume(),
    pause: () => player.pause(),
    seek: (t) => {
      player.seek(t * 1000);
      positionMs = t * 1000;
      lastUpdateAt = Date.now();
    },
    getDuration: () => durationMs / 1000,
    getCurrentTime: () => {
      const estMs = isPaused ? positionMs : positionMs + (Date.now() - lastUpdateAt);
      return estMs / 1000;
    },
    onTime: (cb) => timeSubs.add(cb),
    onPlayState: (cb) => playSubs.add(cb),
    destroy: () => {
      clearInterval(pollTimer);
      timeSubs.clear();
      playSubs.clear();
      player.removeListener("player_state_changed", onStateChanged);
      player.pause().catch(() => {});
    },
  };
}

// Runs in the page's own JS world (declared "world": "MAIN" in the manifest)
// so it sits alongside Spotify's own scripts and can host a real Web
// Playback SDK device. It has NO access to chrome.* APIs — every token
// fetch or Spotify Web API call is relayed through window.postMessage to
// the isolated-world content script (content.jsx), which does have those
// APIs. See that file for the other half of this bridge.

(function () {
  "use strict";

  const SRC = "liner-notes-main";
  const pendingRpc = new Map();
  let rpcCounter = 0;

  function rpc(action, payload) {
    const requestId = "rpc" + ++rpcCounter;
    return new Promise((resolve, reject) => {
      pendingRpc.set(requestId, { resolve, reject });
      window.postMessage({ source: SRC, type: "RPC", requestId, action, payload }, "*");
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "liner-notes-isolated") return;
    if (data.type === "RPC_RESPONSE") {
      const pending = pendingRpc.get(data.requestId);
      if (!pending) return;
      pendingRpc.delete(data.requestId);
      if (data.response?.ok) pending.resolve(data.response);
      else pending.reject(new Error(data.response?.error || "RPC failed"));
    } else if (data.type === "COMMAND") {
      handleCommand(data.action, data.payload);
    }
  });

  function postState(state) {
    window.postMessage({ source: SRC, type: "STATE", state }, "*");
  }

  // open.spotify.com's own Content-Security-Policy blocks loading
  // sdk.scdn.co from a script tag we insert (CSP applies to the page
  // regardless of who inserted the node). blob: URLs are allowed though, so
  // we fetch the SDK's source as text through the background worker (which
  // isn't bound by the page's policy at all) and load it that way instead.
  async function loadSdk() {
    if (window.Spotify) return;
    const res = await rpc("FETCH_SDK_SCRIPT", {});
    const blob = new Blob([res.code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      window.onSpotifyWebPlaybackSDKReady = resolve;
      const tag = document.createElement("script");
      tag.src = url;
      tag.onerror = () => reject(new Error("Failed to execute the fetched Spotify SDK script."));
      document.head.appendChild(tag);
    });
    URL.revokeObjectURL(url);
  }

  let player = null;
  let deviceId = null;
  let currentTrack = null; // { uri, name, artist }
  let pollTimer = null;
  let posMs = 0;
  let durMs = 0;
  let paused = true;
  let lastUpdateAt = Date.now();

  // We never call "play" ourselves — the whole point is that you keep
  // browsing and pressing play inside Spotify's own page as usual. Once you
  // pick "Liner Notes" from Spotify's device switcher, every track you play
  // there arrives here as a player_state_changed event, same as any other
  // Spotify Connect device.
  async function ensurePlayer() {
    if (player) return;
    await loadSdk();
    player = new window.Spotify.Player({
      name: "Liner Notes",
      getOAuthToken: async (cb) => {
        try {
          const res = await rpc("GET_TOKEN", {});
          cb(res.token);
        } catch {
          cb(null);
        }
      },
      volume: 0.8,
    });

    player.addListener("ready", ({ device_id }) => {
      deviceId = device_id;
      postState({ event: "ready", deviceId });
    });
    player.addListener("not_ready", () => postState({ event: "not_ready" }));
    player.addListener("initialization_error", ({ message }) => postState({ event: "error", message }));
    player.addListener("authentication_error", ({ message }) => postState({ event: "error", message }));
    player.addListener("account_error", ({ message }) =>
      postState({ event: "error", message: message + " (Spotify Premium is required.)" })
    );
    player.addListener("player_state_changed", (state) => {
      if (!state) {
        currentTrack = null;
        postState({ event: "no_track" });
        return;
      }
      const t = state.track_window?.current_track;
      const trackChanged = t && (!currentTrack || currentTrack.uri !== t.uri);
      if (t) {
        currentTrack = {
          uri: t.uri,
          name: t.name,
          artist: (t.artists || []).map((a) => a.name).join(", "),
        };
      }
      durMs = state.duration || durMs;
      posMs = state.position || 0;
      lastUpdateAt = Date.now();
      paused = state.paused;
      if (trackChanged) postState({ event: "track_changed", track: currentTrack, durationMs: durMs });
      postState({ event: "playstate", paused, durationMs: durMs });
    });

    await player.connect();

    pollTimer = setInterval(() => {
      if (!currentTrack) return;
      const estMs = paused ? posMs : posMs + (Date.now() - lastUpdateAt);
      postState({ event: "time", positionMs: estMs, durationMs: durMs, paused });
    }, 200);
  }

  async function handleCommand(action, payload) {
    try {
      if (action === "INIT") {
        await ensurePlayer();
        return;
      }
      if (!player) await ensurePlayer();

      if (action === "PLAY") {
        await player.resume();
      } else if (action === "PAUSE") {
        await player.pause();
      } else if (action === "SEEK") {
        await player.seek(payload.seconds * 1000);
        posMs = payload.seconds * 1000;
        lastUpdateAt = Date.now();
      }
    } catch (err) {
      postState({ event: "error", message: err.message || String(err) });
    }
  }

  // Let the panel know this bridge is alive.
  window.postMessage({ source: SRC, type: "READY" }, "*");
})();

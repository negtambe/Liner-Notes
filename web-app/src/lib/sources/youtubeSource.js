// YouTube IFrame Player API source. No auth needed. Docs:
// https://developers.google.com/youtube/iframe_api_reference

let apiReadyPromise = null;

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve) => {
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiReadyPromise;
}

export function extractYouTubeId(input) {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1);
    if (url.searchParams.get("v")) return url.searchParams.get("v");
    const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shorts) return shorts[1];
  } catch {
    /* not a URL */
  }
  return null;
}

export async function createYouTubeSource(videoId, mountEl) {
  await loadYouTubeApi();

  const timeSubs = new Set();
  const playSubs = new Set();
  let player = null;
  let pollTimer = null;
  let lastState = -1;

  const ready = new Promise((resolve) => {
    player = new window.YT.Player(mountEl, {
      height: "1",
      width: "1",
      videoId,
      playerVars: { playsinline: 1, controls: 0 },
      events: {
        onReady: () => resolve(),
        onStateChange: (e) => {
          const YT = window.YT.PlayerState;
          if (e.data === lastState) return;
          lastState = e.data;
          if (e.data === YT.PLAYING) {
            for (const cb of playSubs) cb(true);
          } else if (e.data === YT.PAUSED || e.data === YT.ENDED) {
            for (const cb of playSubs) cb(false);
          }
        },
      },
    });
  });

  await ready;

  pollTimer = setInterval(() => {
    if (!player || typeof player.getCurrentTime !== "function") return;
    const t = player.getCurrentTime();
    for (const cb of timeSubs) cb(t);
  }, 250);

  return {
    kind: "youtube",
    hasWaveform: false,
    ready,
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (t) => player.seekTo(t, true),
    getDuration: () => (player.getDuration ? player.getDuration() : 0),
    getCurrentTime: () => (player.getCurrentTime ? player.getCurrentTime() : 0),
    onTime: (cb) => timeSubs.add(cb),
    onPlayState: (cb) => playSubs.add(cb),
    destroy: () => {
      clearInterval(pollTimer);
      timeSubs.clear();
      playSubs.clear();
      try {
        player.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

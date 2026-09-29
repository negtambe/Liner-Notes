// A playable "source" wraps whatever's actually producing audio — a local
// file, YouTube, or Spotify — behind one interface so the rest of the app
// (Deck, transport controls, annotation logic) never has to know which.
//
// Interface every source implements:
//   play(), pause(), seek(seconds)
//   getDuration() -> seconds
//   onTime(cb)        cb(seconds) — called frequently while playing
//   onPlayState(cb)   cb(isPlaying: boolean)
//   destroy()

export function createLocalSource(url) {
  const audio = new Audio(url);
  const timeSubs = new Set();
  const playSubs = new Set();

  audio.addEventListener("timeupdate", () => {
    for (const cb of timeSubs) cb(audio.currentTime);
  });
  audio.addEventListener("play", () => {
    for (const cb of playSubs) cb(true);
  });
  audio.addEventListener("pause", () => {
    for (const cb of playSubs) cb(false);
  });
  audio.addEventListener("ended", () => {
    for (const cb of playSubs) cb(false);
  });

  return {
    kind: "local",
    hasWaveform: true,
    ready: Promise.resolve(),
    play: () => audio.play().catch(() => {}),
    pause: () => audio.pause(),
    seek: (t) => {
      audio.currentTime = t;
    },
    getDuration: () => audio.duration || 0,
    getCurrentTime: () => audio.currentTime || 0,
    onTime: (cb) => timeSubs.add(cb),
    onPlayState: (cb) => playSubs.add(cb),
    destroy: () => {
      audio.pause();
      audio.src = "";
      timeSubs.clear();
      playSubs.clear();
    },
  };
}

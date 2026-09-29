export async function computePeaks(file, buckets) {
  const buf = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let audioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(buf);
  } finally {
    try {
      ctx.close();
    } catch {
      /* ignore */
    }
  }
  const raw = audioBuffer.getChannelData(0);
  const block = Math.max(1, Math.floor(raw.length / buckets));
  const peaks = new Array(buckets).fill(0);
  for (let i = 0; i < buckets; i++) {
    const start = i * block;
    let sum = 0;
    let count = 0;
    for (let j = 0; j < block && start + j < raw.length; j++) {
      sum += Math.abs(raw[start + j]);
      count++;
    }
    peaks[i] = count ? sum / count : 0;
  }
  let max = 0;
  for (const p of peaks) if (p > max) max = p;
  if (max <= 0) max = 1;
  for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / max;
  return { peaks, duration: audioBuffer.duration };
}

export function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

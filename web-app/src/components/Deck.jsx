import { useEffect, useRef } from "react";
import { fmtTime } from "../lib/audio";
import { tagMeta } from "../lib/store";

function readCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function Deck({
  track,
  isPlaying,
  currentTimeRef,
  onToggle,
  onSeekRatio,
  currentAnns,
  otherAnns,
  displayTime,
  duration,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rafRef = useRef(null);

  const hasWaveform = track?.hasWaveform && track.peaks && track.peaks.length;

  useEffect(() => {
    if (!hasWaveform) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    function resize() {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const w = wrap.clientWidth;
      const cssH = 96;
      const dpr = window.devicePixelRatio || 1;
      canvas.style.height = cssH + "px";
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.floor(cssH * dpr);
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);

    function draw() {
      const w = canvas.width;
      const ht = canvas.height;
      ctx.clearRect(0, 0, w, ht);
      const surface2 = readCSSVar("--surface-2");
      ctx.fillStyle = surface2 || "#eee";
      ctx.fillRect(0, 0, w, ht);

      const peaks = track?.peaks || [];
      const dur = track?.duration || 0;
      const t = currentTimeRef.current || 0;
      const progress = dur > 0 ? Math.min(1, t / dur) : 0;

      const mutedColor = readCSSVar("--muted") || "#999";
      const accentColor = readCSSVar("--accent") || "#c80";

      if (peaks.length) {
        const n = peaks.length;
        const barW = w / n;
        const mid = ht / 2;
        for (let i = 0; i < n; i++) {
          const amp = peaks[i];
          const barH = Math.max(2, amp * (ht * 0.42));
          const x = i * barW;
          const played = i / n <= progress;
          ctx.fillStyle = played ? accentColor : mutedColor;
          ctx.globalAlpha = played ? 0.95 : 0.45;
          ctx.fillRect(x, mid - barH, Math.max(1, barW - 1), barH * 2);
        }
        ctx.globalAlpha = 1;
      }

      if (dur > 0) {
        const px = progress * w;
        ctx.fillStyle = readCSSVar("--fg") || "#111";
        ctx.fillRect(px - 1, 0, 2, ht);
      }

      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [track?.id, hasWaveform]);

  function handleWaveformClick(e) {
    if (!track || !duration) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeekRatio(Math.max(0, Math.min(1, ratio)));
  }

  function handleBarClick(e) {
    if (!track || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeekRatio(Math.max(0, Math.min(1, ratio)));
  }

  function tickRow(anns, dim) {
    return (
      <div className={"markrow" + (dim ? " dim" : "")}>
        {anns.map((a) => {
          const left = duration ? (a.t / duration) * 100 : 0;
          const style = { left: left + "%" };
          if (!dim) style.background = `var(${tagMeta(a.tag).varName})`;
          return <div className="tick" key={a.id} style={style} title={`${fmtTime(a.t)} — ${a.text}`} />;
        })}
      </div>
    );
  }

  const progress = duration > 0 ? Math.min(1, displayTime / duration) : 0;

  return (
    <div>
      <div className="deck-head">
        <div className="deck-title">
          {track ? track.name : "No track loaded"}
          {track && !hasWaveform ? <span className="status-line" style={{ marginLeft: 8 }}>({track.kind})</span> : null}
        </div>
        <div className="time">
          {fmtTime(displayTime)} / {fmtTime(duration)}
        </div>
      </div>
      <div className="transport">
        <button className="play-btn" onClick={onToggle} disabled={!track} aria-label={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? (
            <svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" /></svg>
          )}
        </button>
        <div style={{ flex: 1, color: "var(--muted)", fontSize: 12 }}>
          {track ? (hasWaveform ? "Click the waveform to scrub." : "Click the bar to scrub.") : "Load a track above to start."}
        </div>
      </div>

      {track ? tickRow(currentAnns, false) : null}

      {hasWaveform ? (
        <div className="canvas-wrap" ref={wrapRef}>
          <canvas ref={canvasRef} onClick={handleWaveformClick} />
        </div>
      ) : (
        <div
          className="canvas-wrap"
          onClick={handleBarClick}
          style={{
            height: 40,
            borderRadius: 8,
            background: "var(--surface-2)",
            position: "relative",
            cursor: track ? "pointer" : "default",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${progress * 100}%`,
              background: "var(--accent)",
              opacity: 0.9,
            }}
          />
        </div>
      )}

      {track ? tickRow(otherAnns, true) : null}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import Deck from "./components/Deck";
import Composer from "./components/Composer";
import Ledger from "./components/Ledger";
import SourceRack from "./components/SourceRack";
import { computePeaks, uid } from "./lib/audio";
import { loadStore, saveStore } from "./lib/store";
import { createLocalSource } from "./lib/sources/localSource";
import { createYouTubeSource } from "./lib/sources/youtubeSource";
import { createSpotifySource } from "./lib/sources/spotifySource";
import * as spotifyAuth from "./lib/spotifyAuth";

export default function App() {
  const [tracks, setTracks] = useState([]);
  const [currentTrackId, setCurrentTrackId] = useState(null);
  const [passes, setPasses] = useState({});
  const [currentPassId, setCurrentPassId] = useState({});
  const [annotations, setAnnotations] = useState({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTime, setComposerTime] = useState(0);
  const [compareOn, setCompareOn] = useState(false);
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [spotifyLoggedIn, setSpotifyLoggedIn] = useState(Boolean(spotifyAuth.getStoredToken()));
  const [spotifyStatus, setSpotifyStatus] = useState("");

  const currentTimeRef = useRef(0);
  const activeSourceRef = useRef(null);
  const youtubeMountRef = useRef(null);

  // Handle Spotify's OAuth redirect (?code=...) once on load.
  useEffect(() => {
    (async () => {
      try {
        const handled = await spotifyAuth.handleRedirectCallback();
        if (handled) setSpotifyLoggedIn(true);
      } catch (err) {
        setSpotifyStatus(err.message || String(err));
      }
    })();
  }, []);

  // Load persisted passes/annotations once.
  useEffect(() => {
    const store = loadStore();
    setPasses(store.passes || {});
    setAnnotations(store.annotations || {});
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveStore({ passes, annotations });
  }, [passes, annotations, loaded]);

  const currentTrack = useMemo(() => tracks.find((t) => t.id === currentTrackId) || null, [tracks, currentTrackId]);
  const fileKey = currentTrack ? currentTrack.fileKey : null;
  const trackPasses = (fileKey && passes[fileKey]) || [];
  const activePassId = fileKey ? currentPassId[fileKey] : null;
  const trackAnns = (fileKey && annotations[fileKey]) || [];
  const currentAnns = trackAnns.filter((a) => a.passId === activePassId).sort((x, y) => x.t - y.t);
  const otherAnns = trackAnns.filter((a) => a.passId !== activePassId);

  function ensurePassForKey(key) {
    setPasses((prev) => {
      if (prev[key] && prev[key].length) return prev;
      const firstPassId = uid();
      const next = { ...prev, [key]: [{ id: firstPassId, label: "Listen 1", createdAt: Date.now() }] };
      setCurrentPassId((prevIds) => (prevIds[key] ? prevIds : { ...prevIds, [key]: firstPassId }));
      return next;
    });
  }

  function attachSource(source) {
    activeSourceRef.current = source;
    source.onTime((t) => {
      currentTimeRef.current = t;
      setDisplayTime(t);
    });
    source.onPlayState((p) => setIsPlaying(p));
    setDuration(source.getDuration());
    // Duration for streamed sources often isn't known until the first
    // state/metadata event; poll briefly to pick it up.
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const d = source.getDuration();
      if (d > 0) {
        setDuration(d);
        clearInterval(iv);
      }
      if (tries > 40) clearInterval(iv);
    }, 250);
  }

  async function switchToTrack(track) {
    if (activeSourceRef.current) {
      activeSourceRef.current.destroy();
      activeSourceRef.current = null;
    }
    if (youtubeMountRef.current) youtubeMountRef.current.innerHTML = "";

    setIsPlaying(false);
    setDisplayTime(0);
    currentTimeRef.current = 0;
    setDuration(track.duration || 0);
    setCompareOn(false);
    setCurrentTrackId(track.id);
    ensurePassForKey(track.fileKey);

    try {
      let source;
      if (track.kind === "local") {
        source = createLocalSource(track.url);
      } else if (track.kind === "youtube") {
        const mount = document.createElement("div");
        youtubeMountRef.current.appendChild(mount);
        source = await createYouTubeSource(track.videoId, mount);
      } else if (track.kind === "spotify") {
        setSpotifyStatus("Connecting to Spotify…");
        source = await createSpotifySource({ uri: track.uri, durationMs: track.durationMs });
        setSpotifyStatus("");
      }
      attachSource(source);
    } catch (err) {
      setSpotifyStatus(err.message || String(err));
    }
  }

  async function addLocalFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      if (!file.type.startsWith("audio/")) continue;
      const key = file.name + "::" + file.size;
      const id = uid();
      const url = URL.createObjectURL(file);
      let result;
      try {
        result = await computePeaks(file, 320);
      } catch {
        result = { peaks: [], duration: 0 };
      }
      const trackObj = {
        id,
        fileKey: key,
        kind: "local",
        hasWaveform: true,
        name: file.name.replace(/\.[^.]+$/, ""),
        url,
        peaks: result.peaks,
        duration: result.duration,
      };
      setTracks((prev) => [...prev, trackObj]);
      switchToTrack(trackObj);
    }
  }

  function addYouTube(videoId, rawUrl) {
    const key = "youtube::" + videoId;
    const existing = tracks.find((t) => t.fileKey === key);
    if (existing) {
      switchToTrack(existing);
      return;
    }
    const trackObj = {
      id: uid(),
      fileKey: key,
      kind: "youtube",
      hasWaveform: false,
      name: "YouTube — " + videoId,
      videoId,
      duration: 0,
      rawUrl,
    };
    setTracks((prev) => [...prev, trackObj]);
    switchToTrack(trackObj);

    // No API key needed for a title — oEmbed is public.
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}&format=json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.title) return;
        const niceName = data.author_name ? `${data.title} — ${data.author_name}` : data.title;
        setTracks((prev) => prev.map((t) => (t.fileKey === key ? { ...t, name: niceName } : t)));
      })
      .catch(() => {
        /* title stays as the video ID — not fatal */
      });
  }

  function addSpotify(result) {
    const key = "spotify::" + result.id;
    const existing = tracks.find((t) => t.fileKey === key);
    if (existing) {
      switchToTrack(existing);
      return;
    }
    const trackObj = {
      id: uid(),
      fileKey: key,
      kind: "spotify",
      hasWaveform: false,
      name: `${result.name} — ${result.artist}`,
      uri: result.uri,
      durationMs: result.durationMs,
      duration: (result.durationMs || 0) / 1000,
    };
    setTracks((prev) => [...prev, trackObj]);
    switchToTrack(trackObj);
  }

  function togglePlay() {
    const source = activeSourceRef.current;
    if (!source) return;
    if (isPlaying) source.pause();
    else source.play();
  }

  function seekRatio(ratio) {
    const source = activeSourceRef.current;
    if (!source || !duration) return;
    const t = ratio * duration;
    source.seek(t);
    currentTimeRef.current = t;
    setDisplayTime(t);
  }

  function seekTo(t) {
    const source = activeSourceRef.current;
    if (!source) return;
    source.seek(t);
    currentTimeRef.current = t;
    setDisplayTime(t);
  }

  function addPass() {
    if (!fileKey) return;
    const list = passes[fileKey] || [];
    const newPass = { id: uid(), label: "Listen " + (list.length + 1), createdAt: Date.now() };
    setPasses((prev) => ({ ...prev, [fileKey]: list.concat([newPass]) }));
    setCurrentPassId((prev) => ({ ...prev, [fileKey]: newPass.id }));
  }

  function openComposer() {
    if (!currentTrack) return;
    setComposerTime(currentTimeRef.current);
    setComposerOpen(true);
  }

  function saveAnnotation(tag, text) {
    if (!fileKey || !activePassId) return;
    const ann = { id: uid(), passId: activePassId, t: composerTime, tag, text, createdAt: Date.now() };
    setAnnotations((prev) => ({ ...prev, [fileKey]: (prev[fileKey] || []).concat([ann]) }));
    setComposerOpen(false);
  }

  function deleteAnnotation(id) {
    if (!fileKey) return;
    setAnnotations((prev) => ({ ...prev, [fileKey]: (prev[fileKey] || []).filter((a) => a.id !== id) }));
  }

  function openCompare() {
    if (trackPasses.length < 2) return;
    setCompareA(trackPasses[0].id);
    setCompareB(trackPasses[trackPasses.length - 1].id);
    setCompareOn(true);
  }

  const compareAAnns = trackAnns.filter((a) => a.passId === compareA).sort((x, y) => x.t - y.t);
  const compareBAnns = trackAnns.filter((a) => a.passId === compareB).sort((x, y) => x.t - y.t);
  const compareBadges = useMemo(() => {
    const badges = {};
    compareBAnns.forEach((b) => {
      let nearest = null;
      let nearestDelta = Infinity;
      compareAAnns.forEach((a) => {
        const d = Math.abs(a.t - b.t);
        if (d < nearestDelta) {
          nearestDelta = d;
          nearest = a;
        }
      });
      if (!nearest || nearestDelta > 3) {
        badges[b.id] = { type: "new", label: "New catch" };
      } else if (nearest.tag !== b.tag) {
        badges[b.id] = { type: "changed", label: "Reconsidered" };
      }
    });
    return badges;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareA, compareB, trackAnns]);

  return (
    <div className="wrap">
      <header>
        <p className="eyebrow">for DJs &amp; the nostalgic</p>
        <h1>Liner Notes</h1>
        <p>
          Stamp what you hear, right when you hear it. Come back on a second or third listen and see what you notice
          this time that you missed the first — from a local file, YouTube, or Spotify.
        </p>
      </header>

      <SourceRack
        tracks={tracks}
        currentTrackId={currentTrackId}
        onSelectTrack={switchToTrack}
        onAddLocalFiles={addLocalFiles}
        onAddYouTube={addYouTube}
        onAddSpotify={addSpotify}
        spotifyLoggedIn={spotifyLoggedIn}
      />
      {spotifyStatus ? <div className="status-line">{spotifyStatus}</div> : null}
      <div ref={youtubeMountRef} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }} />

      {tracks.length === 0 ? (
        <section className="panel empty">
          <h2>Your first listen starts here</h2>
          <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            Load a track — upload a file, paste a YouTube link, or search Spotify — and play it. Every time something
            lands, stamp it without stopping the music.
          </p>
          <ul>
            <li>
              <span className="num">1</span>Play a track and tag moments as they happen — no scrubbing back to find
              them later.
            </li>
            <li>
              <span className="num">2</span>Start a new listen pass for the same track whenever you revisit it.
            </li>
            <li>
              <span className="num">3</span>Compare two passes side by side to see what you caught this time that you
              missed before.
            </li>
          </ul>
        </section>
      ) : (
        <section className="panel">
          <Deck
            track={currentTrack}
            isPlaying={isPlaying}
            currentTimeRef={currentTimeRef}
            onToggle={togglePlay}
            onSeekRatio={seekRatio}
            currentAnns={currentAnns}
            otherAnns={otherAnns}
            displayTime={displayTime}
            duration={duration}
          />
          <div className="add-note-row">
            <button className="btn btn-primary" onClick={openComposer} disabled={!currentTrack}>
              + Stamp a note
            </button>
            {trackPasses.length > 1 ? (
              <button className="btn btn-ghost" onClick={openCompare}>
                Compare listens
              </button>
            ) : null}
          </div>
          <Composer open={composerOpen} time={composerTime} onCancel={() => setComposerOpen(false)} onSave={saveAnnotation} />
        </section>
      )}

      {currentTrack && !compareOn ? (
        <section className="panel">
          <div className="tabs">
            {trackPasses.map((p) => (
              <button
                key={p.id}
                className="tab"
                aria-selected={p.id === activePassId}
                onClick={() => setCurrentPassId((prev) => ({ ...prev, [fileKey]: p.id }))}
              >
                {p.label}
              </button>
            ))}
            <button className="tab" onClick={addPass}>
              + New listen
            </button>
          </div>
          <div style={{ marginTop: 14 }}>
            <Ledger anns={currentAnns} onSeek={seekTo} onDelete={deleteAnnotation} badges={null} />
          </div>
        </section>
      ) : null}

      {currentTrack && compareOn ? (
        <section className="panel">
          <div className="compare-head">
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Comparing</span>
            <select value={compareA} onChange={(e) => setCompareA(e.target.value)}>
              {trackPasses.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>against</span>
            <select value={compareB} onChange={(e) => setCompareB(e.target.value)}>
              {trackPasses.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setCompareOn(false)}>
              Back to single listen
            </button>
          </div>
          <div className="compare-grid">
            <div className="compare-col">
              <h3>{trackPasses.find((p) => p.id === compareA)?.label || "—"}</h3>
              <Ledger anns={compareAAnns} onSeek={seekTo} onDelete={null} badges={null} />
            </div>
            <div className="compare-col">
              <h3>{trackPasses.find((p) => p.id === compareB)?.label || "—"}</h3>
              <Ledger anns={compareBAnns} onSeek={seekTo} onDelete={null} badges={compareBadges} />
            </div>
          </div>
        </section>
      ) : null}

      <footer>
        Local-file notes save to this browser only. YouTube and Spotify notes are matched by video ID / track ID, so
        they'll be there next time you load the same track.
      </footer>
    </div>
  );
}

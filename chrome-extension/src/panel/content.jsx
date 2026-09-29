import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import panelCss from "./panel.css?inline";
import { loadStore, saveStore, TAGS, tagMeta, fmtTime, uid } from "../lib/chromeStore";

// ---- bridge to the MAIN-world player script (main-world.js) ------------
// That script has no chrome.* access, so every Spotify API call it needs
// (a fresh OAuth token, or "start playback on this device") is relayed
// through us via window.postMessage, and we do the real chrome.runtime call.
function sendCommand(action, payload) {
  window.postMessage({ source: "liner-notes-isolated", type: "COMMAND", action, payload }, "*");
}

function installRpcBridge() {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "liner-notes-main" || data.type !== "RPC") return;
    chrome.runtime.sendMessage({ type: data.action, ...data.payload }, (response) => {
      window.postMessage(
        { source: "liner-notes-isolated", type: "RPC_RESPONSE", requestId: data.requestId, response },
        "*"
      );
    });
  });
}

function trackIdFromUri(uri) {
  return uri ? uri.split(":")[2] : null;
}

function Composer({ open, time, onCancel, onSave }) {
  const [tag, setTag] = useState("drop");
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) {
      setTag("drop");
      setText("");
    }
  }, [open, time]);
  if (!open) return null;
  return (
    <div className="ln-composer">
      <div className="ln-status">Stamped at {fmtTime(time)}</div>
      <div className="ln-tagrow">
        {TAGS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="ln-tagchip"
            aria-pressed={tag === t.id}
            onClick={() => setTag(t.id)}
          >
            <span className="ln-dot" style={{ background: `var(${t.varName})` }} />
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        placeholder="What did you catch this time?"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ln-row-end">
        <button className="ln-btn ln-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="ln-btn ln-btn-primary" disabled={!text.trim()} onClick={() => onSave(tag, text.trim())}>
          Save
        </button>
      </div>
    </div>
  );
}

function Ledger({ anns, onSeek, onDelete, badges }) {
  if (!anns.length) return <div className="ln-empty">No notes on this listen yet.</div>;
  return (
    <div className="ln-ledger">
      {anns.map((a) => {
        const tm = tagMeta(a.tag);
        const badge = badges ? badges[a.id] : null;
        return (
          <div className="ln-entry" key={a.id}>
            <button className="ln-t" onClick={() => onSeek(a.t)}>
              {fmtTime(a.t)}
            </button>
            <div>
              <div className="ln-tagline">
                <span className="ln-dot" style={{ background: `var(${tm.varName})` }} />
                <span>{tm.label}{badge ? ` · ${badge}` : ""}</span>
              </div>
              <div className="ln-note">{a.text}</div>
            </div>
            {onDelete ? (
              <button className="ln-del" onClick={() => onDelete(a.id)}>
                remove
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);

  const [track, setTrack] = useState(null); // { uri, name, artist }
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [passes, setPasses] = useState({});
  const [currentPassId, setCurrentPassId] = useState({});
  const [annotations, setAnnotations] = useState({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTime, setComposerTime] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const positionRef = useRef(0);

  useEffect(() => {
    installRpcBridge();
    chrome.runtime.sendMessage({ type: "GET_LOGIN_STATE" }, (res) => {
      if (res?.ok) setLoggedIn(res.loggedIn);
    });

    function onWindowMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "liner-notes-main") return;
      if (data.type === "READY") {
        setBridgeReady(true);
      } else if (data.type === "STATE") {
        const s = data.state;
        if (s.event === "error") {
          setStatusMsg(s.message);
          setStatusError(true);
        } else if (s.event === "ready") {
          setStatusMsg('Connected. Pick "Liner Notes" from Spotify\'s device switcher to start.');
          setStatusError(false);
        } else if (s.event === "track_changed") {
          setTrack(s.track);
          setDurationMs(s.durationMs || 0);
          setStatusMsg("");
        } else if (s.event === "playstate") {
          setIsPlaying(!s.paused);
          if (s.durationMs) setDurationMs(s.durationMs);
        } else if (s.event === "time") {
          positionRef.current = s.positionMs;
          setPositionMs(s.positionMs);
          setDurationMs(s.durationMs);
        } else if (s.event === "no_track") {
          setTrack(null);
        }
      }
    }
    window.addEventListener("message", onWindowMessage);
    return () => window.removeEventListener("message", onWindowMessage);
  }, []);

  useEffect(() => {
    loadStore().then((store) => {
      setPasses(store.passes || {});
      setAnnotations(store.annotations || {});
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    saveStore({ passes, annotations });
  }, [passes, annotations, loaded]);

  const fileKey = track ? "spotify::" + trackIdFromUri(track.uri) : null;

  useEffect(() => {
    if (!fileKey) return;
    setPasses((prev) => {
      if (prev[fileKey] && prev[fileKey].length) return prev;
      const firstPassId = uid();
      setCurrentPassId((prevIds) => (prevIds[fileKey] ? prevIds : { ...prevIds, [fileKey]: firstPassId }));
      return { ...prev, [fileKey]: [{ id: firstPassId, label: "Listen 1", createdAt: Date.now() }] };
    });
  }, [fileKey]);

  const trackPasses = (fileKey && passes[fileKey]) || [];
  const activePassId = fileKey ? currentPassId[fileKey] : null;
  const trackAnns = (fileKey && annotations[fileKey]) || [];
  const currentAnns = trackAnns.filter((a) => a.passId === activePassId).sort((x, y) => x.t - y.t);

  function login() {
    setStatusMsg("Opening Spotify login…");
    setStatusError(false);
    chrome.runtime.sendMessage({ type: "LOGIN" }, (res) => {
      if (res?.ok) {
        setLoggedIn(true);
        setStatusMsg("Logged in. Connecting…");
        sendCommand("INIT", {});
      } else {
        setStatusMsg(res?.error || "Login failed.");
        setStatusError(true);
      }
    });
  }

  function logout() {
    chrome.runtime.sendMessage({ type: "LOGOUT" }, () => {
      setLoggedIn(false);
      setTrack(null);
      setStatusMsg("Logged out.");
    });
  }

  useEffect(() => {
    if (loggedIn && bridgeReady) sendCommand("INIT", {});
  }, [loggedIn, bridgeReady]);

  function togglePlay() {
    sendCommand(isPlaying ? "PAUSE" : "PLAY", {});
  }
  function seekTo(seconds) {
    sendCommand("SEEK", { seconds });
    positionRef.current = seconds * 1000;
    setPositionMs(seconds * 1000);
  }
  function seekRatio(ratio) {
    if (!durationMs) return;
    seekTo((ratio * durationMs) / 1000);
  }

  function addPass() {
    if (!fileKey) return;
    const list = passes[fileKey] || [];
    const newPass = { id: uid(), label: "Listen " + (list.length + 1), createdAt: Date.now() };
    setPasses((prev) => ({ ...prev, [fileKey]: list.concat([newPass]) }));
    setCurrentPassId((prev) => ({ ...prev, [fileKey]: newPass.id }));
  }

  function openComposer() {
    if (!track) return;
    setComposerTime(positionRef.current / 1000);
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

  const progress = durationMs ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <div className={"ln-root" + (collapsed ? " collapsed" : "")}>
      <div className="ln-header" onClick={() => setCollapsed((c) => !c)}>
        <span className="ln-title">🎵 Liner Notes</span>
        <span style={{ color: "var(--muted)", fontSize: 11 }}>{collapsed ? "expand" : "—"}</span>
      </div>
      {!collapsed && (
        <div className="ln-body">
          {!loggedIn ? (
            <>
              <div className="ln-status">Log in, then pick "Liner Notes" from Spotify's device switcher.</div>
              <button className="ln-btn ln-btn-primary" style={{ marginTop: 8 }} onClick={login}>
                Log in with Spotify
              </button>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="ln-status">{statusMsg}</span>
                <button className="ln-btn ln-btn-ghost" onClick={logout}>
                  Log out
                </button>
              </div>

              {track ? (
                <>
                  <div style={{ marginTop: 10 }}>
                    <div className="ln-track-name">{track.name}</div>
                    <div className="ln-track-artist">{track.artist}</div>
                  </div>
                  <div className="ln-transport">
                    <button className="ln-play" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
                      {isPlaying ? (
                        <svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" /></svg>
                      )}
                    </button>
                    <span className="ln-time" style={{ flex: 1 }}>
                      {fmtTime(positionMs / 1000)} / {fmtTime(durationMs / 1000)}
                    </span>
                  </div>
                  <div className="ln-markrow">
                    {currentAnns.map((a) => (
                      <div
                        key={a.id}
                        className="ln-tick"
                        style={{ left: durationMs ? (a.t / (durationMs / 1000)) * 100 + "%" : 0, background: `var(${tagMeta(a.tag).varName})` }}
                        title={fmtTime(a.t) + " — " + a.text}
                      />
                    ))}
                  </div>
                  <div
                    className="ln-bar"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      seekRatio((e.clientX - rect.left) / rect.width);
                    }}
                  >
                    <div className="ln-bar-fill" style={{ width: progress * 100 + "%" }} />
                  </div>

                  <button className="ln-btn ln-btn-primary" style={{ marginTop: 10 }} onClick={openComposer}>
                    + Stamp a note
                  </button>
                  <Composer open={composerOpen} time={composerTime} onCancel={() => setComposerOpen(false)} onSave={saveAnnotation} />

                  <div className="ln-tabs">
                    {trackPasses.map((p) => (
                      <button
                        key={p.id}
                        className="ln-tab"
                        aria-selected={p.id === activePassId}
                        onClick={() => setCurrentPassId((prev) => ({ ...prev, [fileKey]: p.id }))}
                      >
                        {p.label}
                      </button>
                    ))}
                    <button className="ln-tab" onClick={addPass}>
                      + New listen
                    </button>
                  </div>
                  <Ledger anns={currentAnns} onSeek={(t) => seekTo(t)} onDelete={deleteAnnotation} badges={null} />
                </>
              ) : (
                <div className="ln-status" style={{ marginTop: 8 }}>
                  Nothing playing on this device yet. Play any track on open.spotify.com, then switch the active
                  device (bottom-right speaker icon) to "Liner Notes".
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function mount() {
  const host = document.createElement("div");
  host.id = "liner-notes-host";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = panelCss;
  shadow.appendChild(style);
  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);
  createRoot(mountPoint).render(<App />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}

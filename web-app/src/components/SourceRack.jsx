import { useRef, useState } from "react";
import { extractYouTubeId } from "../lib/sources/youtubeSource";
import {
  extractSpotifyTrackId,
  extractSpotifyPlaylistId,
  searchTracks,
  getTrack,
  getPlaylistTracks,
} from "../lib/sources/spotifySource";
import * as spotifyAuth from "../lib/spotifyAuth";

export default function SourceRack({
  tracks,
  currentTrackId,
  onSelectTrack,
  onAddLocalFiles,
  onAddYouTube,
  onAddSpotify,
  spotifyLoggedIn,
}) {
  const fileInputRef = useRef(null);
  const [ytUrl, setYtUrl] = useState("");
  const [ytError, setYtError] = useState("");
  const [spotifyQuery, setSpotifyQuery] = useState("");
  const [spotifyResults, setSpotifyResults] = useState([]);
  const [spotifyError, setSpotifyError] = useState("");
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [playlistTracks, setPlaylistTracks] = useState(null); // null = not showing a playlist

  function submitYouTube(e) {
    e.preventDefault();
    setYtError("");
    const id = extractYouTubeId(ytUrl);
    if (!id) {
      setYtError("Couldn't find a video ID in that link.");
      return;
    }
    onAddYouTube(id, ytUrl);
    setYtUrl("");
  }

  async function submitSpotifySearch(e) {
    e.preventDefault();
    setSpotifyError("");
    setSpotifyResults([]);
    setPlaylistTracks(null);
    if (!spotifyQuery.trim()) return;

    // A pasted playlist link loads the whole thing so you can click through
    // it without typing each song — a pasted track link/URI loads directly.
    const playlistId = extractSpotifyPlaylistId(spotifyQuery);
    const directId = extractSpotifyTrackId(spotifyQuery);
    setSpotifyBusy(true);
    try {
      if (playlistId) {
        const tracks = await getPlaylistTracks(playlistId);
        setPlaylistTracks(tracks);
      } else if (directId) {
        const track = await getTrack(directId);
        onAddSpotify(track);
        setSpotifyQuery("");
      } else {
        const results = await searchTracks(spotifyQuery);
        setSpotifyResults(results);
      }
    } catch (err) {
      setSpotifyError(err.message || String(err));
    } finally {
      setSpotifyBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="rack-row">
        {tracks.map((t) => (
          <button
            key={t.id}
            type="button"
            className="chip"
            aria-pressed={t.id === currentTrackId}
            onClick={() => onSelectTrack(t)}
          >
            <span className="dot" />
            {t.name}
            <span className="kind">{t.kind}</span>
          </button>
        ))}
        <button className="btn" type="button" onClick={() => fileInputRef.current.click()}>
          + Upload file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={(e) => {
            onAddLocalFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="source-row">
        <form onSubmit={submitYouTube}>
          <input
            type="text"
            placeholder="Paste a YouTube link"
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
          />
          <button className="btn" type="submit">
            Add
          </button>
        </form>
      </div>
      {ytError ? <div className="status-line error">{ytError}</div> : null}

      <div className="spotify-panel">
        {!spotifyLoggedIn ? (
          <div className="source-row">
            <button className="btn" type="button" onClick={() => spotifyAuth.login()}>
              Log in with Spotify
            </button>
            <span className="status-line">Needed once, to play full tracks (Premium required).</span>
          </div>
        ) : (
          <>
            <div className="source-row">
              <form onSubmit={submitSpotifySearch}>
                <input
                  type="text"
                  placeholder="Search, or paste a track or playlist link"
                  value={spotifyQuery}
                  onChange={(e) => setSpotifyQuery(e.target.value)}
                />
                <button className="btn" type="submit" disabled={spotifyBusy}>
                  {spotifyBusy ? "…" : "Go"}
                </button>
              </form>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  spotifyAuth.logout();
                  window.location.reload();
                }}
              >
                Log out
              </button>
            </div>
            {spotifyError ? <div className="status-line error">{spotifyError}</div> : null}
            {playlistTracks ? (
              <div className="search-results" style={{ maxHeight: 260, overflowY: "auto" }}>
                <div className="status-line">{playlistTracks.length} tracks — click any to load it</div>
                {playlistTracks.map((r) => (
                  <div className="search-result" key={r.id}>
                    <span>
                      {r.name} — {r.artist}
                    </span>
                    <button type="button" onClick={() => onAddSpotify(r)}>
                      Load
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {spotifyResults.length ? (
              <div className="search-results">
                {spotifyResults.map((r) => (
                  <div className="search-result" key={r.id}>
                    <span>
                      {r.name} — {r.artist}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onAddSpotify(r);
                        setSpotifyResults([]);
                        setSpotifyQuery("");
                      }}
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

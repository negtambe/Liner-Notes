# Liner Notes

Stamp timestamped notes on a track while it plays, across multiple listens — then compare passes to see what you caught this time that you missed before.

Built for DJs (and the nostalgic): everything sounds different after the fourth listen, so the point is to capture what you notice the moment you notice it, not reconstruct it later from memory.

**Live:** [liner-notes-tambe.netlify.app](https://liner-notes-tambe.netlify.app/)

## Two ways to use it

This repo ships the same annotation engine twice, because building the first version surfaced a real product insight: a separate tool competes with the fact that DJs already live inside Spotify.

### [`web-app/`](./web-app) — standalone app
A React + Vite app. Annotate a local file upload (with a real waveform, computed client-side via the Web Audio API), a YouTube link, or a Spotify track/playlist (Spotify Web Playback SDK, via OAuth).

### [`chrome-extension/`](./chrome-extension) — lives on open.spotify.com
A Manifest V3 Chrome extension. Instead of a separate tab, it floats an annotate panel directly on Spotify's own page. You keep browsing and playing music exactly as you normally would; switching Spotify's own "Connect to a device" picker to **Liner Notes** routes playback through the extension, which follows along automatically — no in-extension search step at all.

## Installing the Chrome extension

This isn't published to the Chrome Web Store (that review takes days to weeks), so it installs the developer-mode way:

1. Download the built extension from the [Releases page](https://github.com/negtambe/liner-notes/releases/latest) and unzip it.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.
5. Open [open.spotify.com](https://open.spotify.com), start playing something, then switch the device picker (bottom right of Spotify's player) to **Liner Notes**.

Note: this extension logs in through my own Spotify developer app, which is in Development Mode and capped at 25 approved users — so a given Spotify account needs to be added by me before it can log in.

## What made the extension a real build, not a port

- **Two isolated JS worlds, one bridge.** Spotify's Web Playback SDK has to run in the page's own JS context (`"world": "MAIN"` in the manifest) to behave like a real Spotify Connect device. The UI panel runs in the extension's isolated world for safety/sandboxing. Neither can see the other's variables, so every command (play/pause/seek) and every state update (position, track, pause state) crosses via `window.postMessage`.
- **A live CSP had to be worked around.** `open.spotify.com` blocks a directly-inserted `<script src="https://sdk.scdn.co/...">` tag via its own Content-Security-Policy — even though the SDK is Spotify's own script. Fix: fetch the SDK's source as text through the background service worker (not bound by the page's policy), then load it via a `blob:` URL, which the same policy explicitly allows.
- **OAuth without a backend.** Both the web app and the extension use Authorization Code + PKCE, so no client secret ever ships to the browser. The extension additionally uses `chrome.identity.launchWebAuthFlow` with a `https://<extension-id>.chromiumapp.org/` redirect — which requires pinning the extension's ID in advance via a generated keypair (`manifest-key.txt`), so the redirect URI is known before the extension is ever loaded.

## Stack

React, Vite, Web Audio API, Spotify Web API + Web Playback SDK, YouTube IFrame API, Chrome Manifest V3 (`@crxjs/vite-plugin`).

Built end-to-end with Claude Code.

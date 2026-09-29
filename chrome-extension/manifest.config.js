import { defineManifest } from "@crxjs/vite-plugin";
import fs from "node:fs";

const manifestKey = fs.readFileSync(new URL("./manifest-key.txt", import.meta.url), "utf-8").trim();

export default defineManifest({
  manifest_version: 3,
  name: "Liner Notes",
  description: "Stamp timestamped notes on a Spotify track while it plays, across multiple listens.",
  version: "1.0.0",
  key: manifestKey,
  icons: {
    16: "icons/icon16.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
  background: {
    service_worker: "src/background/index.js",
    type: "module",
  },
  permissions: ["storage", "identity"],
  host_permissions: ["https://api.spotify.com/*", "https://accounts.spotify.com/*", "https://sdk.scdn.co/*"],
  content_scripts: [
    {
      matches: ["https://open.spotify.com/*"],
      js: ["src/player/main-world.js"],
      world: "MAIN",
      run_at: "document_idle",
    },
    {
      matches: ["https://open.spotify.com/*"],
      js: ["src/panel/content.jsx"],
      run_at: "document_idle",
    },
  ],
});

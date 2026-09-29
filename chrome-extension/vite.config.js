import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  define: {
    "process.env.SPOTIFY_CLIENT_ID": JSON.stringify("6ac40f44035848bc8ffd89f892b37661"),
  },
});

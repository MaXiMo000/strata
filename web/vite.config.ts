import { defineConfig } from "vite";

// Dev: Vite serves the UI and proxies /api to FastAPI, so the browser sees one origin (as in production, where
// FastAPI serves web/dist). API port: STRATA_API, default 8012 (the workspace launch config).
export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.STRATA_API ?? 8012}` },
  },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1600 },
});

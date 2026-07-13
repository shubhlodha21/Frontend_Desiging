import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tailwind v4 is a Vite plugin now — no postcss.config, no tailwind.config.js.
// This is exactly how the original app is wired.
//
// Dev proxy: the MD screen talks to the FastAPI backend (webapp/backend) at
// :8000. Proxying /api + /ws keeps everything same-origin in dev (no CORS);
// in prod the app is built into the dist the backend already serves.
const GT_API = process.env.GT_API_TARGET || "http://127.0.0.1:8000";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: GT_API, changeOrigin: true },
      "/ws": { target: GT_API, ws: true, changeOrigin: true },
    },
  },
});

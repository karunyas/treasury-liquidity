import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = process.env.API_PORT ?? "4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Keeps the browser on one origin in dev, so no CORS and no base-URL config.
    proxy: {
      "/api": { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});

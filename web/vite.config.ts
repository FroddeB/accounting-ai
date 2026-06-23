import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, proxy API calls to the Express backend on :3000 so cookies and routes
// behave exactly as in production (same origin from the SPA's view).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { outDir: "dist" },
});

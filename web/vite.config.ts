import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Daybill frontend build. The UI (App.tsx, theme.css, assets) is copied
// verbatim from the canonical artifact client; this config only wires the
// standard Vite + React + Tailwind v4 pipeline the artifact's SDK builder
// used internally.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 4096,
  },
});

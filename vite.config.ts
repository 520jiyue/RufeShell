import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  build: { target: "es2022" },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/.preview-data/**", "**/.rea-runtime/**"] } },
  envPrefix: ["VITE_", "TAURI_"],
});


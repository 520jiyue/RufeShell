import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  build: { target: "es2022" },
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
});


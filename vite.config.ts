import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    allowedHosts: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: ["es2021", "chrome105", "safari13"],
    minify: "esbuild",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});

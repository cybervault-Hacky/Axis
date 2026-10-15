import { defineConfig } from "vite";
import { resolve } from "node:path";

// AXIS renderer build. Output is consumed by Electron via file:// in
// production and by the Vite dev server (http://localhost:5173) in
// development — see src/main/main.ts and the `dev:electron` / `dev:renderer`
// npm scripts. Also doubles as the standalone browser preview described in
// README.md.
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Allow this app to be served through a reverse-proxied preview host
    // (e.g. Arena's sandboxed preview domains) in addition to localhost.
    allowedHosts: true
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true
  }
});

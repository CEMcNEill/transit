import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Plain static SPA build: deployable to Vercel as-is and wrappable by Tauri later.
// Baked data (repo-root data/: sectors/, sim/) is served as static files at /sectors, /sim.
// When the dev server sits behind a reverse proxy (e.g. tailscale serve), set
// TRANSIT_DEV_HOST to the public hostname and TRANSIT_HMR_CLIENT_PORT to its port.
const devHost = process.env.TRANSIT_DEV_HOST;
const hmrClientPort = Number(process.env.TRANSIT_HMR_CLIENT_PORT) || undefined;

export default defineConfig({
  plugins: [react()],
  publicDir: fileURLToPath(new URL('../../data', import.meta.url)),
  server: {
    ...(devHost ? { allowedHosts: [devHost] } : {}),
    ...(hmrClientPort ? { hmr: { clientPort: hmrClientPort } } : {}),
  },
});

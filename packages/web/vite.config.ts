import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Plain static SPA build: deployable to Vercel as-is and wrappable by Tauri later.
// When the dev server sits behind a reverse proxy (e.g. tailscale serve), set
// TRANSIT_DEV_HOST to the public hostname and TRANSIT_HMR_CLIENT_PORT to its port.
const devHost = process.env.TRANSIT_DEV_HOST;
const hmrClientPort = Number(process.env.TRANSIT_HMR_CLIENT_PORT) || undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    ...(devHost ? { allowedHosts: [devHost] } : {}),
    ...(hmrClientPort ? { hmr: { clientPort: hmrClientPort } } : {}),
  },
});

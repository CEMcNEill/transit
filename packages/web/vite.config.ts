import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Plain static SPA build: deployable to Vercel as-is and wrappable by Tauri later.
export default defineConfig({
  plugins: [react()],
});

import { defineConfig, devices } from '@playwright/test';

// Smoke test against the Vite dev server. Needs baked sectors (`make data`).
const port = 5198;

export default defineConfig({
  testDir: './e2e',
  // Full UI playthroughs are opt-in (PLAYTHROUGH=1); `make e2e` runs the smoke test only.
  testIgnore: process.env.PLAYTHROUGH ? [] : ['**/playthrough.spec.ts'],
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } },
    },
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

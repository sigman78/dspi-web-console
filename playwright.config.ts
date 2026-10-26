import { defineConfig } from '@playwright/test';

const channel = process.env.PW_CHANNEL ?? 'msedge';
const port = 5177;

export default defineConfig({
  testDir: 'test/layout',
  outputDir: 'test-results',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { channel, headless: true, viewport: { width: 1440, height: 790 }, baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    // A leftover server on the port must fail loudly rather than serve stale code.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

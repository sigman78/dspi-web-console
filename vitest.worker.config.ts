import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Relay tests run inside the Workers runtime. Separate from vitest.config.ts
// (jsdom SPA suite), which never looks under worker/.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { ALLOWED_ORIGINS: 'https://console.test, https://other.test' } },
    }),
  ],
  test: {
    include: ['worker/**/*.test.ts'],
  },
});

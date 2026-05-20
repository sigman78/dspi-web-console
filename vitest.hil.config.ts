import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// HIL runner. Picks up *.hil.test.ts only. fileParallelism is disabled
// so HIL tests run serially in a single fork — libusb device claim must
// not race across workers. Long timeouts because real USB transfers are
// slower than memory.
//
// Environment is jsdom + the Svelte plugin so HIL files that import
// `*.svelte.ts` modules can use Svelte 5 runes ($state, $derived). The
// device/protocol HIL tests don't need DOM and pay only ~1 s of startup
// for the shared environment — acceptable for this small suite.
export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['**/*.hil.test.ts'],
    environment: 'jsdom',
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    exclude: ['**/node_modules/**'],
  },
  resolve: {
    conditions: ['browser'],
    // Same `@/*` alias as vite.config.ts / vitest.config.ts so HIL tests
    // and their transitive imports under src/ can resolve consistently.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Disable Node's built-in Web Storage in worker processes. The harness injects
// `--localstorage-file` (no path) into spawned Node processes, which otherwise
// installs a broken `localStorage` stub on globalThis that shadows jsdom's and
// emits a startup warning. Disabling webstorage entirely lets jsdom own
// `localStorage` and silences the warning. NODE_OPTIONS is inherited by forks.
//
// `--no-experimental-webstorage` requires Node >= 22.4, so CI is pinned to Node
// 22 via .nvmrc (older Node rejects the flag in NODE_OPTIONS and hangs the run).
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --no-experimental-webstorage`.trim();

export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __GIT_SHA__: JSON.stringify('test'),
    __BUILD_DATE__: JSON.stringify('1970-01-01'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,js}'],
    exclude: ['**/node_modules/**', '**/*.hil.test.ts'],
  },
  resolve: {
    conditions: ['browser'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@test': fileURLToPath(new URL('./test', import.meta.url)),
    },
  },
});

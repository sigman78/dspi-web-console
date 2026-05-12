import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Disable Node's built-in Web Storage in worker processes. The harness injects
// `--localstorage-file` (no path) into spawned Node processes, which otherwise
// installs a broken `localStorage` stub on globalThis that shadows jsdom's and
// emits a startup warning. Disabling webstorage entirely lets jsdom own
// `localStorage` and silences the warning. NODE_OPTIONS is inherited by forks.
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --no-experimental-webstorage`.trim();

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,js}'],
    exclude: ['**/node_modules/**', '**/*.hil.test.ts'],
  },
  resolve: {
    conditions: ['browser'],
  },
});

import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { paletteCSS } from './src/styles/palette-colors'
import pkg from './package.json' with { type: 'json' }

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'local'
  }
}

// Serve the channel palette (derived from the constant COLORS table) as a real
// stylesheet evaluated at build time. `import 'virtual:palette.css'` in main.ts
// then folds it into the CSS graph -- bundled, cacheable, and present at first
// paint -- instead of a runtime document.head <style> injection.
function paletteCssPlugin(): Plugin {
  const virtualId = 'virtual:palette.css'
  const resolvedId = '\0' + virtualId
  return {
    name: 'palette-css',
    resolveId: (id) => (id === virtualId ? resolvedId : null),
    load: (id) => (id === resolvedId ? paletteCSS() : null),
  }
}

// Inline the emitted stylesheet(s) into index.html at build, replacing the
// <link rel="stylesheet"> with a <style> block (one fewer request, no FOUC).
// Matches by asset basename so it is agnostic to the deploy base path, and only
// inlines a chunk that the HTML actually links (leaves any async CSS alone).
function inlineCssPlugin(): Plugin {
  return {
    name: 'inline-css',
    enforce: 'post',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        for (const [file, chunk] of Object.entries(ctx.bundle)) {
          if (!file.endsWith('.css') || chunk.type !== 'asset') continue
          const base = (file.split('/').pop() ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const link = new RegExp(`<link[^>]+href="[^"]*${base}"[^>]*>`)
          if (!link.test(html)) continue
          html = html.replace(link, `<style>${chunk.source}</style>`)
          delete ctx.bundle[file]
        }
        return html
      },
    },
  }
}

export default defineConfig({
  plugins: [svelte(), paletteCssPlugin(), inlineCssPlugin()],
  base: process.env.GITHUB_PAGES_BASE ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

<script lang="ts">
  import { REPO_URL } from '@/buildInfo';

  const base = import.meta.env.BASE_URL;
  // Address worth retyping on a desktop; a bare "/" base adds nothing.
  const consoleUrl = location.host + (base === '/' ? '' : base);
</script>

<main class="mobile-splash">
  <img class="logo" src="{base}app.svg" alt="" />
  <h1 class="title">DSPI · CTRL</h1>
  <p class="tagline">Web console for the DSPi audio processor.</p>

  <section class="panel" aria-label="Desktop browser required">
    <div class="panel__header">DESKTOP REQUIRED</div>
    <div class="panel__body">
      <p>
        This console configures the DSPi board over a USB cable and is built
        for desktop browsers — there's nothing it can do from a phone or
        tablet.
      </p>
      <p>To set up your device, open this address on a PC or laptop in Chrome or Edge:</p>
      <code class="url">{consoleUrl}</code>
    </div>
  </section>

  <footer class="footer-links">
    <a href={REPO_URL} target="_blank" rel="noreferrer">OPEN SOURCE · GITHUB ↗</a>
    <span class="sep">·</span>
    <span>WEBUSB · CHROME / EDGE</span>
  </footer>
</main>

<style>
  .mobile-splash {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px 20px;
    font-family: var(--font-mono);
    text-align: center;
  }
  .logo {
    width: 88px;
    height: 88px;
    margin-bottom: 4px;
  }
  .title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 5px;
    color: var(--text);
  }
  .tagline {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text-dim);
  }
  .panel {
    margin-top: 14px;
    width: min(440px, 100%);
    border: 1px solid color-mix(in oklab, var(--warn) 55%, var(--border));
    background: color-mix(in oklab, var(--warn) 7%, var(--panel));
    border-radius: var(--radius);
    overflow: hidden;
    text-align: left;
  }
  .panel__header {
    padding: 7px 14px;
    font-size: 10px;
    letter-spacing: 2px;
    color: var(--warn);
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    border-bottom: 1px solid color-mix(in oklab, var(--warn) 35%, var(--border));
  }
  .panel__body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .panel__body p {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-dim);
  }
  .url {
    align-self: stretch;
    padding: 9px 12px;
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--accent);
    background: color-mix(in oklab, var(--accent) 6%, transparent);
    border: 1px solid var(--border);
    border-radius: 3px;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .footer-links {
    margin-top: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 9px;
    letter-spacing: 1px;
    color: var(--text-faint);
  }
  .footer-links a {
    color: var(--text-faint);
    text-decoration: none;
  }
  .footer-links a:hover { color: var(--text); text-decoration: underline; }
  .sep { color: var(--border-hi); }
</style>

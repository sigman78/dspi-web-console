<script lang="ts">
  import TopBar from '@/components/chrome/TopBar.svelte';
  import ChannelRail from '@/components/chrome/ChannelRail.svelte';
  import ConnectingHero from '@/components/chrome/ConnectingHero.svelte';
  import ConnectedApp from '@/components/chrome/ConnectedApp.svelte';
  import EqSpectrum from '@/components/chrome/EqSpectrum.svelte';
  import PresetBoundaryModal from '@/components/presets/PresetBoundaryModal.svelte';
  import Toaster from '@/components/chrome/Toaster.svelte';
  import { app, settings, initialBoot } from '@/state';
  import { handleTabShortcut } from '@/input/tabShortcuts';
  import { heroOverride } from '@/devOptions';

  // Visual-test override: ?hero forces the connecting hero to render even
  // when a (real or mock) device would otherwise be connected. Read once at
  // module load. Orthogonal to ?mock, so a mocked-but-connected session
  // still hides the hero unless ?hero is also present.
  const hero = heroOverride();

  const appState = $derived(app.current);

  // On page load, a returning user's device (settings.lastSerial set) auto-
  // connects and loads its snapshot. Hold a quiet splash over that window rather
  // than flashing the connect hero, then swap straight to the fully-populated UI.
  // Cold users (no lastSerial) get the hero immediately; an errored attempt
  // (e.g. device-in-use) yields to the hero so its advisory shows.
  const showSplash = $derived(
    !hero &&
    initialBoot.active &&
    settings.lastSerial != null &&
    appState.kind !== 'errored'
  );

  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if (app.current.kind === 'ready' && handleTabShortcut(e)) e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="shell">
  <TopBar />
  <PresetBoundaryModal />
  <main>
    {#if showSplash}
      <div class="boot-splash" role="status" aria-label="Connecting to device">
        <EqSpectrum />
        <div class="boot-status">CONNECTING…</div>
      </div>
    {:else if !hero && appState.kind === 'ready'}
      <div class="work">
        <ChannelRail />
        <div class="content">
          <ConnectedApp session={appState.session} />
        </div>
      </div>
    {:else}
      <div class="hero-wrap">
        <ConnectingHero />
      </div>
    {/if}
  </main>
  <Toaster />
</div>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
    overflow: hidden;
  }
  main {
    overflow: hidden;
    min-height: 0;
  }
  .work {
    display: flex;
    height: 100%;
    min-height: 0;
  }
  .content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: var(--pad);
  }
  .hero-wrap {
    display: grid;
    place-items: center;
    min-height: 100%;
    padding: var(--pad);
  }
  .boot-splash {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    min-height: 100%;
    padding: var(--pad);
    /* Stay invisible for the first 150ms, then fade in over 250ms. A reload that
       reconnects quickly tears the splash down before it becomes visible, so the
       common fast path shows nothing; only a genuinely slow connect reveals it. */
    opacity: 0.8;
    animation: splash-in 0.25s ease-out 0.15s both;
  }
  @keyframes splash-in {
    from { opacity: 0; }
    to   { opacity: 0.8; }
  }
  .boot-status {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--text-dim);
    animation: boot-pulse 1.6s ease-in-out infinite;
  }
  @keyframes boot-pulse {
    0%, 100% { opacity: 0.45; }
    50%      { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .boot-status { animation: none; }
  }
</style>

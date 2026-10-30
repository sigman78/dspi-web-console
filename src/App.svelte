<script lang="ts">
  import ConnectingHero from '@/components/chrome/ConnectingHero.svelte';
  import NoveauShell from '@/components/noveau/NoveauShell.svelte';
  import EqSpectrum from '@/components/chrome/EqSpectrum.svelte';
  import PresetBoundaryModal from '@/components/noveau/presets/PresetBoundaryModal.svelte';
  import Toaster from '@/components/chrome/Toaster.svelte';
  import ConfirmHost from '@/components/chrome/ConfirmHost.svelte';
  import LentView from '@/components/remote/LentView.svelte';
  import RemoteDevPanel from '@/components/remote/RemoteDevPanel.svelte';
  import { app, settings, initialBoot, activeLease } from '@/state';
  import { heroOverride, remoteManualSignaling } from '@/devOptions';

  // Visual-test override: ?hero forces the connecting hero to render even
  // when a (real or mock) device would otherwise be connected. Read once at
  // module load. Orthogonal to ?mock, so a mocked-but-connected session
  // still hides the hero unless ?hero is also present.
  const hero = heroOverride();

  const remoteDev = remoteManualSignaling();

  const appState = $derived(app.current);
  const lease = $derived(activeLease());

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
</script>

<div class="shell">
  <PresetBoundaryModal />
  <ConfirmHost />
  <main data-budget>
    {#if showSplash}
      <div class="boot-splash" role="status" aria-label="Connecting to device">
        <EqSpectrum />
        <div class="boot-status">CONNECTING…</div>
      </div>
    {:else if !hero && appState.kind === 'ready' && lease}
      <div class="hero-wrap">
        <LentView {lease} serial={appState.session.info.serial} />
      </div>
    {:else if !hero && appState.kind === 'ready'}
      {#key appState.session}
        <NoveauShell session={appState.session} />
      {/key}
    {:else}
      <div class="hero-wrap">
        <ConnectingHero />
      </div>
    {/if}
  </main>
  {#if remoteDev}<RemoteDevPanel />{/if}
  <Toaster />
</div>

<style>
  .shell {
    height: 100%;
    overflow: hidden;
  }
  main {
    height: 100%;
    overflow: hidden;
    min-height: 0;
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

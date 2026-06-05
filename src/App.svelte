<script lang="ts">
  import TopBar from '@/components/chrome/TopBar.svelte';
  import TabBar from '@/components/chrome/TabBar.svelte';
  import ConnectingHero from '@/components/chrome/ConnectingHero.svelte';
  import ConnectedApp from '@/components/chrome/ConnectedApp.svelte';
  import PresetBoundaryModal from '@/components/presets/PresetBoundaryModal.svelte';
  import Toaster from '@/components/chrome/Toaster.svelte';
  import { app } from '@/state';
  import { handleTabShortcut } from '@/input/tabShortcuts';

  // Visual-test override: ?mock=hero forces the connecting hero to render
  // even when a (real or mock) device would otherwise be connected. Read once
  // at module load. Distinct value from ?mock=rp2040 / ?mock=rp2350 in
  // src/main.ts so a mocked-but-connected session still hides the hero.
  const mockHero = (() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('mock') === 'hero';
  })();

  const appState = $derived(app.current);

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
  <TabBar />
  <PresetBoundaryModal />
  <main>
    {#if !mockHero && appState.kind === 'ready'}
      <ConnectedApp session={appState.session} />
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
    grid-template-rows: auto auto 1fr;
    height: 100%;
    overflow: hidden;
  }
  main {
    padding: var(--pad);
    overflow: auto;
    min-height: 0;
  }
  .hero-wrap {
    display: grid;
    place-items: center;
    min-height: 100%;
  }
</style>

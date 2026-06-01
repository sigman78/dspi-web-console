<script lang="ts">
  import TopBar from './components/chrome/TopBar.svelte';
  import TabBar from './components/chrome/TabBar.svelte';
  import OverviewTab from './components/tabs/OverviewTab.svelte';
  import EqualizerTab from './components/tabs/EqualizerTab.svelte';
  import MixerTab from './components/tabs/MixerTab.svelte';
  import ProcessingTab from './components/tabs/ProcessingTab.svelte';
  import PresetsTab from './components/tabs/PresetsTab.svelte';
  import SystemTab from './components/tabs/SystemTab.svelte';
  import ConnectingHero from './components/chrome/ConnectingHero.svelte';
  import PresetBoundaryModal from './components/chrome/PresetBoundaryModal.svelte';
  import Toaster from './components/chrome/Toaster.svelte';
  import { settings, session } from './state';
  import { handleTabShortcut } from './input/tabShortcuts';

  // Visual-test override: ?mock=hero forces the connecting hero to render
  // even when a (real or mock) device would otherwise be connected. Read once
  // at module load. Distinct value from ?mock=rp2040 / ?mock=rp2350 in
  // src/main.ts so a mocked-but-connected session still hides the hero.
  const mockHero = (() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('mock') === 'hero';
  })();

  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if (session.status === 'connected' && handleTabShortcut(e)) e.preventDefault();
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
    {#if mockHero || session.status !== 'connected'}
      <div class="hero-wrap">
        <ConnectingHero />
      </div>
    {:else if settings.tab === 'overview'}
      <OverviewTab />
    {:else if settings.tab === 'eq'}
      <EqualizerTab />
    {:else if settings.tab === 'mixer'}
      <MixerTab />
    {:else if settings.tab === 'processing'}
      <ProcessingTab />
    {:else if settings.tab === 'presets'}
      <PresetsTab />
    {:else if settings.tab === 'system'}
      <SystemTab />
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

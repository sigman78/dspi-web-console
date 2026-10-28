<script lang="ts">
  import { setContext } from 'svelte';
  import type { ReadySession } from '@/state';
  import { reconcileSelectedChannel, selectionVisibilityOf, settings } from '@/state';
  import { SESSION_KEY } from '@/components/sessionContext';
  import ChannelList from '@/components/chrome/ChannelList.svelte';
  import IconRail from './IconRail.svelte';
  import RailHead from './RailHead.svelte';
  import RailFoot from './RailFoot.svelte';
  import StatusLine from './StatusLine.svelte';
  import TuneView from '@/components/noveau/tune/TuneView.svelte';
  import ProgramView from '@/components/noveau/program/ProgramView.svelte';
  import SetupView from '@/components/noveau/setup/SetupView.svelte';
  import ControlView from '@/components/noveau/control/ControlView.svelte';
  import { controlAvailable } from '@/components/noveau/control/controlPages';
  import AboutView from '@/components/noveau/about/AboutView.svelte';
  import { noveauUi } from './noveauUi.svelte';
  import { destinations, destinationShortcut } from './destinations';

  const { session }: { session: ReadySession } = $props();
  // The session is stable while this component is mounted: App keys this
  // component on the session, so a disconnect, a reconnect, or a device switch
  // each mount a fresh instance. Setting context once at init is therefore
  // correct -- the non-reactive capture is intended.
  // svelte-ignore state_referenced_locally
  setContext(SESSION_KEY, session);

  const channelVisibility = $derived(selectionVisibilityOf(
    session.mirror.current?.outputs ?? [],
    session.telemetry.activeInputChannels,
  ));
  noveauUi.healthOpen = false;
  noveauUi.presetsOpen = false;
  noveauUi.selectedBand = null;
  // The selected band belongs to one channel: drop it on a switch, whichever
  // destination the switch happens on.
  let lastChannel = settings.selectedChannel;
  $effect(() => {
    const id = settings.selectedChannel;
    if (id !== lastChannel) noveauUi.selectedBand = null;
    lastChannel = id;
  });
  $effect(() => {
    if (noveauUi.destination === 'control' && !controlAvailable(session.device.capabilities.features)) {
      noveauUi.destination = 'setup';
    }
  });
  $effect(() => {
    reconcileSelectedChannel(session.mirror.current?.channels, channelVisibility);
  });
  function onKey(e: KeyboardEvent) {
    const order = destinations(session.device.capabilities.features).map((d) => d.key);
    const next = destinationShortcut(e, order, noveauUi.destination);
    if (next === null) return;
    e.preventDefault();
    noveauUi.destination = next;
    noveauUi.presetsOpen = false;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="noveau-shell">
  <IconRail />
  <aside class="crail">
    <RailHead />
    <ChannelList linkPeers={noveauUi.destination === 'tune'} />
    <RailFoot />
  </aside>
  <section class="ws" aria-label="Workspace">
    {#if noveauUi.destination === 'tune'}
      <TuneView />
    {:else if noveauUi.destination === 'program'}
      <ProgramView />
    {:else if noveauUi.destination === 'setup'}
      <SetupView />
    {:else if noveauUi.destination === 'control' && controlAvailable(session.device.capabilities.features)}
      <ControlView />
    {:else}
      <AboutView />
    {/if}
  </section>
  <StatusLine />
</div>

<style>
  .noveau-shell {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: 56px 200px 1fr;
    grid-template-rows: 1fr var(--h-status);
    overflow: hidden;
    background: var(--bg-glow);
  }
  .noveau-shell > :global(*) { min-width: 0; min-height: 0; overflow: hidden; }
  .noveau-shell > :global(.crail) { overflow: visible; }
  .noveau-shell > :global(.status) { overflow: visible; }
  .crail {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    background: var(--surface-chrome);
  }
  .ws { grid-column: 3; grid-row: 1; display: flex; padding: 12px 16px; }
</style>

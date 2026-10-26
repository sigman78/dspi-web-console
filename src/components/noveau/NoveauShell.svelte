<script lang="ts">
  import { setContext } from 'svelte';
  import type { ReadySession } from '@/state';
  import { reconcileSelectedChannel, selectionVisibilityOf } from '@/state';
  import { SESSION_KEY } from '@/components/sessionContext';
  import ChannelList from '@/components/chrome/ChannelList.svelte';
  import IconRail from './IconRail.svelte';
  import RailHead from './RailHead.svelte';
  import RailFoot from './RailFoot.svelte';
  import StatusLine from './StatusLine.svelte';
  import TuneView from './tune/TuneView.svelte';
  import ProgramView from './program/ProgramView.svelte';
  import SetupView from './setup/SetupView.svelte';
  import { noveauUi } from './noveauUi.svelte';

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
    { includeDisabledOutputs: true },
  ));
  noveauUi.healthOpen = false;
  noveauUi.selectedBand = null;
  $effect(() => {
    reconcileSelectedChannel(session.mirror.current?.channels, channelVisibility);
  });
</script>

<div class="noveau-shell">
  <IconRail />
  <aside class="crail">
    <RailHead />
    <ChannelList disabledOutputs="stub" dense />
    <RailFoot />
  </aside>
  <section class="ws" aria-label="Workspace">
    {#if noveauUi.destination === 'tune'}
      <TuneView />
    {:else if noveauUi.destination === 'program'}
      <ProgramView />
    {:else if noveauUi.destination === 'setup'}
      <SetupView />
    {:else}
      <div class="soon">{noveauUi.destination.toUpperCase()} — not in this slice</div>
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
    grid-template-rows: 1fr 28px;
    overflow: hidden;
    background: var(--bg-glow);
  }
  .noveau-shell > :global(*) { min-width: 0; min-height: 0; overflow: hidden; }
  .noveau-shell > :global(.crail) { overflow: visible; }
  .crail {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg) 80%, var(--text) 2%);
  }
  .ws { display: flex; padding: 12px 16px; }
  .soon {
    flex: 1;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
  }
</style>

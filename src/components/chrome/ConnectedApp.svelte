<script lang="ts">
  import { setContext } from 'svelte';
  import type { ReadySession } from '@/state';
  import { settings } from '@/state';
  import { SESSION_KEY } from '@/components/sessionContext';
  import OverviewTab from '@/components/tabs/OverviewTab.svelte';
  import EqualizerTab from '@/components/tabs/EqualizerTab.svelte';
  import MixerTab from '@/components/tabs/MixerTab.svelte';
  import ProcessingTab from '@/components/tabs/ProcessingTab.svelte';
  import PresetsTab from '@/components/tabs/PresetsTab.svelte';
  import SystemTab from '@/components/tabs/SystemTab.svelte';

  const { session }: { session: ReadySession } = $props();
  // The session is stable while this component is mounted (a disconnect unmounts
  // ConnectedApp; a reconnect mounts a fresh instance with the new session), so
  // setting context once at init is correct -- the non-reactive capture is intended.
  // svelte-ignore state_referenced_locally
  setContext(SESSION_KEY, session);
</script>

{#if settings.tab === 'overview'}
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

<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { connection } from '@/state';
  import { setLgSoundSyncEnabled } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const lgs = $derived(s.mirror.current?.lgSoundSync);
  const enabled = $derived(lgs?.enabled ?? false);
</script>

<Panel code="SY.09" title="LG SOUND SYNC">
  {#snippet right()}
    <ToggleSwitch
      size="sm"
      checked={enabled}
      disabled={!connected || !lgs}
      ariaLabel={enabled ? 'Disable LG Sound Sync' : 'Enable LG Sound Sync'}
      onChange={(v) => setLgSoundSyncEnabled(s, v)}
    />
  {/snippet}

  {#if lgs}
    <div class="kvgrid" class:dimmed={!enabled}>
      <KV label="PRESENT" value={lgs.present ? 'YES' : 'NO'} tone={lgs.present ? 'ok' : 'off'} />
      <KV label="VOLUME"  value={`${lgs.volume}`} />
      <KV label="MUTED"   value={lgs.muted ? 'YES' : 'NO'} tone={lgs.muted ? undefined : 'off'} />
    </div>
  {/if}
</Panel>

<style>
  .kvgrid { padding: 12px 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .kvgrid.dimmed { opacity: 0.45; }
</style>

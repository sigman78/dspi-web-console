<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import NamePopover from '@/components/chrome/NamePopover.svelte';
  import * as Runtime from '@/runtime';
  import * as Domain from '@/domain';
  import { connection } from '@/state';
  import { formatRateKHz } from '@/utils';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const info = $derived(s.telemetry.info);

  const uid = $props.id();
  const renameBtnId = `rename-btn-${uid}`;
  let renameOpen = $state(false);
  $effect(() => { if (s.names.deviceSupported !== true) renameOpen = false; });

  async function commitName(name: string): Promise<void> {
    renameOpen = false;
    if (name !== s.names.device) await Runtime.setDeviceName(s, name);
  }
</script>

<Panel title="DEVICE">
  {#snippet right()}
    {#if s.names.deviceSupported === true}
      <button id={renameBtnId} class="chip icon" aria-haspopup="dialog" aria-expanded={renameOpen} title="Rename this device" aria-label="Rename this device" onclick={() => { renameOpen = !renameOpen; }}>✎</button>
    {/if}
  {/snippet}
  <div class="kvrows">
    <KV inline label="STATUS"   value={connection.label} tone={connection.connected ? 'ok' : 'off'} />
    <div class="name-host">
      <KV inline label="NAME" value={s.names.device || '—'} />
      {#if renameOpen}
        <NamePopover title="RENAME DEVICE" value={s.names.device} maxlength={Domain.DEVICE_NAME_MAX_LEN} ignore={`#${renameBtnId}`} onCommit={commitName} onCancel={() => { renameOpen = false; }} />
      {/if}
    </div>
    <KV inline label="SERIAL"   value={s.info.serial} />
    <KV inline label="PLATFORM" value={snap?.platform.name ?? '—'} />
    <KV inline label="OUTPUTS"  value={`${snap?.platform.outputCount ?? 0} / ${snap?.platform.totalChannelCount ?? 0}`} />
    <KV inline label="CLOCK"    value={info?.clockHz != null ? `${(info.clockHz / 1_000_000).toFixed(0)} MHz` : '—'} />
    <KV inline label="SAMPLE"   value={info?.sampleRateHz != null ? formatRateKHz(info.sampleRateHz) : '—'} />
    <KV inline label="VOLTAGE"  value={info?.coreVoltageMv != null ? `${(info.coreVoltageMv / 1000).toFixed(3)} V` : '—'} />
  </div>
</Panel>

<style>
  .name-host { border-top: 1px solid var(--wash); }
</style>

<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { connection } from '@/state';
  import { formatRateKHz } from '@/utils';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const info = $derived(s.telemetry.info);
</script>

<Panel title="DEVICE">
  <div class="kvrows">
    <KV inline label="STATUS"   value={connection.label} tone={connection.connected ? 'ok' : 'off'} />
    <KV inline label="SERIAL"   value={s.info.serial} />
    <KV inline label="PLATFORM" value={snap?.platform.name ?? '—'} />
    <KV inline label="OUTPUTS"  value={`${snap?.platform.outputCount ?? 0} / ${snap?.platform.totalChannelCount ?? 0}`} />
    <KV inline label="CLOCK"    value={info?.clockHz != null ? `${(info.clockHz / 1_000_000).toFixed(0)} MHz` : '—'} />
    <KV inline label="SAMPLE"   value={info?.sampleRateHz != null ? formatRateKHz(info.sampleRateHz) : '—'} />
    <KV inline label="VOLTAGE"  value={info?.coreVoltageMv != null ? `${(info.coreVoltageMv / 1000).toFixed(3)} V` : '—'} />
  </div>
</Panel>

<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { formatRateKHz } from '@/utils';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const info = $derived(s.telemetry.info);
</script>

<Panel title="TELEMETRY">
  <div class="kvgrid">
    <KV label="CLOCK"     value={info?.clockHz       != null ? `${(info.clockHz / 1_000_000).toFixed(0)} MHz` : '—'} />
    <KV label="SAMPLE"    value={info?.sampleRateHz  != null ? formatRateKHz(info.sampleRateHz) : '—'} />
    <KV label="VOLTAGE"   value={info?.coreVoltageMv != null ? `${(info.coreVoltageMv / 1000).toFixed(3)} V` : '—'} />
    <KV label="TEMP"      value={info?.tempCDegC     != null ? `${(info.tempCDegC / 100).toFixed(1)} °C` : '—'} />
    <KV label="CPU0"      value={`${s.telemetry.cpu0}%`} />
    <KV label="CPU1"      value={`${s.telemetry.cpu1}%`} />
    <KV label="STREAMING" value={s.telemetry.streaming ? 'YES' : 'NO'} tone={s.telemetry.streaming ? 'ok' : 'off'} />
    <KV label="PDM"       value={s.telemetry.pdmActive ? 'ACTIVE' : 'IDLE'} tone={s.telemetry.pdmActive ? 'ok' : 'off'} />
    <KV label="POLL ERR"  value={String(s.telemetry.errorCount)} tone={s.telemetry.errorCount > 0 ? undefined : 'off'} />
  </div>
</Panel>

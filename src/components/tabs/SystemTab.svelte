<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import KV from '../chrome/KV.svelte';
  import { dsp } from '../../state/dsp.svelte';
  import { session } from '../../state/session.svelte';
  import { status } from '../../state/telemetry.svelte';
  import ChannelNamesPanel from '../system/ChannelNamesPanel.svelte';

  const snap = $derived(dsp.live);
  const info = $derived(status.info);

  // Sum the cumulative xrun counters into a single "all good?" indicator.
  // Per-field nullables (PartialSystemInfo) coalesce to 0 here: a counter
  // we couldn't read this poll is invisible to the "all clean" total. A
  // non-zero value we *did* read is what should drive the indicator.
  const totalErrors = $derived(
    info
      ? (info.pdmRingOverruns ?? 0) + (info.pdmRingUnderruns ?? 0)
      + (info.pdmDmaOverruns ?? 0) + (info.pdmDmaUnderruns ?? 0)
      + (info.spdifOverruns ?? 0) + (info.spdifUnderruns ?? 0)
      + (info.spdifStarvationsTotal ?? 0)
      : 0
  );

  function fmtNum(v: number | null | undefined): string { return v == null ? '—' : String(v); }
  function isNonZero(v: number | null | undefined): boolean { return v != null && v > 0; }
</script>

<div class="grid">
  <div class="col">
    <!-- TODO(persist): replace with real actions when protocol verbs land -->
    <Panel code="SY.03" title="PERSISTENCE">
      <div class="row">
        <button disabled title="Not yet implemented">COMMIT</button>
        <button disabled title="Not yet implemented">REVERT</button>
        <button disabled title="Not yet implemented">FACTORY RESET</button>
      </div>
    </Panel>
  </div>

  <div class="col">
    <ChannelNamesPanel />
  </div>

  <div class="col">
    <Panel code="SY.01" title="DEVICE">
      <div class="kvgrid">
        <KV label="STATUS"   value={session.status.toUpperCase()} tone={session.status === 'connected' ? 'ok' : 'off'} />
        <KV label="SERIAL"   value={session.identity.serial || '—'} />
        <KV label="FIRMWARE" value={session.identity.firmwareVersion || '—'} />
        <KV label="PLATFORM" value={snap?.platform.name ?? '—'} />
        <KV label="FORMAT"   value={`V${snap?.formatVersion ?? 0}`} />
        <KV label="OUTPUTS"  value={`${snap?.platform.outputCount ?? 0} / ${snap?.platform.totalChannelCount ?? 0}`} />
      </div>
    </Panel>

    <Panel code="SY.02" title="TELEMETRY">
      <div class="kvgrid">
        <KV label="CLOCK"     value={info?.clockHz       != null ? `${(info.clockHz / 1_000_000).toFixed(0)} MHz` : '—'} />
        <KV label="SAMPLE"    value={info?.sampleRateHz  != null ? `${(info.sampleRateHz / 1000).toFixed(1)} kHz` : '—'} />
        <KV label="VOLTAGE"   value={info?.coreVoltageMv != null ? `${(info.coreVoltageMv / 1000).toFixed(3)} V` : '—'} />
        <KV label="TEMP"      value={info?.tempCDegC     != null ? `${(info.tempCDegC / 100).toFixed(1)} °C` : '—'} />
        <KV label="CPU0"      value={`${status.cpu0}%`} />
        <KV label="CPU1"      value={`${status.cpu1}%`} />
        <KV label="STREAMING" value={status.streaming ? 'YES' : 'NO'} tone={status.streaming ? 'ok' : 'off'} />
        <KV label="PDM"       value={status.pdmActive ? 'ACTIVE' : 'IDLE'} tone={status.pdmActive ? 'ok' : 'off'} />
        <KV label="SEQ"       value={String(status.sequence)} />
        <KV label="POLL ERR"  value={String(status.errorCount)} tone={status.errorCount > 0 ? undefined : 'off'} />
      </div>
    </Panel>

    <Panel code="SY.04" title="ERROR COUNTERS">
      {#snippet right()}
        <span class="badge" class:on={totalErrors === 0} class:err={totalErrors > 0}>
          {totalErrors === 0 ? 'CLEAN' : `${totalErrors} ERR`}
        </span>
      {/snippet}
      <div class="kvgrid">
        <KV label="PDM RING OVR" value={fmtNum(info?.pdmRingOverruns)}       tone={isNonZero(info?.pdmRingOverruns)       ? undefined : 'off'} />
        <KV label="PDM RING UNR" value={fmtNum(info?.pdmRingUnderruns)}      tone={isNonZero(info?.pdmRingUnderruns)      ? undefined : 'off'} />
        <KV label="PDM DMA OVR"  value={fmtNum(info?.pdmDmaOverruns)}        tone={isNonZero(info?.pdmDmaOverruns)        ? undefined : 'off'} />
        <KV label="PDM DMA UNR"  value={fmtNum(info?.pdmDmaUnderruns)}       tone={isNonZero(info?.pdmDmaUnderruns)       ? undefined : 'off'} />
        <KV label="SPDIF OVR"    value={fmtNum(info?.spdifOverruns)}         tone={isNonZero(info?.spdifOverruns)         ? undefined : 'off'} />
        <KV label="SPDIF UNR"    value={fmtNum(info?.spdifUnderruns)}        tone={isNonZero(info?.spdifUnderruns)        ? undefined : 'off'} />
        <KV label="SPDIF STARV"  value={fmtNum(info?.spdifStarvationsTotal)} tone={isNonZero(info?.spdifStarvationsTotal) ? undefined : 'off'} />
      </div>
      <!-- TODO(system-info-extra): per-slot SPDIF starvations (wValues 18-21)
           and USB state (10-12) -->
    </Panel>
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pad); height: 100%; }
  .col { display: flex; flex-direction: column; gap: var(--pad); min-height: 0; }
  .kvgrid { padding: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .row { padding: 14px; display: flex; gap: 8px; }
  .row button {
    padding: 4px 10px; border-radius: 4px;
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 1px;
    background: var(--panel-solid); color: var(--text-dim);
    border: 1px solid var(--border); cursor: pointer;
  }
  .row button:disabled { opacity: 0.45; cursor: default; }

  .badge {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 1px;
    padding: 2px 6px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-faint);
  }
  .badge.on {
    background: color-mix(in oklab, var(--ok) 10%, transparent);
    border-color: color-mix(in oklab, var(--ok) 40%, transparent);
    color: var(--ok);
  }
  .badge.err {
    background: color-mix(in oklab, var(--err) 10%, transparent);
    border-color: color-mix(in oklab, var(--err) 40%, transparent);
    color: var(--err);
  }
</style>

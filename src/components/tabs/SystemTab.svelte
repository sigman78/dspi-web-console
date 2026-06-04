<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import KV from '../chrome/KV.svelte';
  import { connection } from '@/state';
  import ChannelNamesPanel from '../system/ChannelNamesPanel.svelte';
  import ResetPanel from '../system/ResetPanel.svelte';
  import OutputsPanel from '../system/OutputsPanel.svelte';
  import I2sClockPanel from '../system/I2sClockPanel.svelte';
  import { chKey } from '@/styles/palette';
  import { clearClips } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snap = $derived(s.mirror.current);
  const info = $derived(s.telemetry.info);
  const connected = $derived(connection.connected);

  function fmtNum(v: number | null | undefined): string { return v == null ? '—' : String(v); }
  function isNonZero(v: number | null | undefined): boolean { return v != null && v > 0; }
</script>

<div class="grid">
  <div class="col">
    <ResetPanel />
    <OutputsPanel />
    <I2sClockPanel />
  </div>

  <div class="col">
    <ChannelNamesPanel />
  </div>

  <div class="col">
    <Panel code="SY.01" title="DEVICE">
      <div class="kvgrid">
        <KV label="STATUS"   value={connection.label} tone={connection.connected ? 'ok' : 'off'} />
        <KV label="SERIAL"   value={s.info.serial} />
        <KV label="FIRMWARE" value={s.info.capabilities.fwLabel} />
        <KV label="PLATFORM" value={snap?.platform.name ?? '—'} />
        <KV label="FORMAT"   value={s.info.capabilities.wireLabel} />
        <KV label="OUTPUTS"  value={`${snap?.platform.outputCount ?? 0} / ${snap?.platform.totalChannelCount ?? 0}`} />
      </div>
    </Panel>

    <Panel code="SY.02" title="TELEMETRY">
      <div class="kvgrid">
        <KV label="CLOCK"     value={info?.clockHz       != null ? `${(info.clockHz / 1_000_000).toFixed(0)} MHz` : '—'} />
        <KV label="SAMPLE"    value={info?.sampleRateHz  != null ? `${(info.sampleRateHz / 1000).toFixed(1)} kHz` : '—'} />
        <KV label="VOLTAGE"   value={info?.coreVoltageMv != null ? `${(info.coreVoltageMv / 1000).toFixed(3)} V` : '—'} />
        <KV label="TEMP"      value={info?.tempCDegC     != null ? `${(info.tempCDegC / 100).toFixed(1)} °C` : '—'} />
        <KV label="CPU0"      value={`${s.telemetry.cpu0}%`} />
        <KV label="CPU1"      value={`${s.telemetry.cpu1}%`} />
        <KV label="STREAMING" value={s.telemetry.streaming ? 'YES' : 'NO'} tone={s.telemetry.streaming ? 'ok' : 'off'} />
        <KV label="PDM"       value={s.telemetry.pdmActive ? 'ACTIVE' : 'IDLE'} tone={s.telemetry.pdmActive ? 'ok' : 'off'} />
        <KV label="SEQ"       value={String(s.telemetry.sequence)} />
        <KV label="POLL ERR"  value={String(s.telemetry.errorCount)} tone={s.telemetry.errorCount > 0 ? undefined : 'off'} />
      </div>
    </Panel>

    <Panel code="SY.04" title="ERROR COUNTERS">
      {#snippet right()}
        <button class="clear-btn" onclick={() => clearClips(s)} disabled={!connected} title="Clear latched clip flags">CLEAR</button>
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
      <!-- Per-channel latched clip flags. Latch is host-side OR over every
           20 Hz status packet; CLEAR button above resets both firmware
           (ClearClips 0x83) and host array. -->
      <div class="subhdr">CLIP / CHANNEL</div>
      <div class="clipgrid">
        {#each snap?.channels ?? [] as ch (ch.id)}
          <span
            class="clipsq ch-{chKey(ch.id)}"
            class:on={s.telemetry.clipLatched[ch.id]}
            title="{ch.shortName} · {ch.name}{s.telemetry.clipLatched[ch.id] ? ' · CLIPPED' : ''}"
          >{ch.shortName}</span>
        {/each}
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

  .clear-btn {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 2px 8px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
  }
  .clear-btn:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-hi);
  }
  .clear-btn:disabled { opacity: 0.45; cursor: default; }

  /* Per-channel latched clip indicators. Sits below the kvgrid; spans the
     panel's full width regardless of the kvgrid's 2-column layout (this is
     a sibling element). */
  .subhdr {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--text-faint);
    padding: 8px 14px 0;
    border-top: 1px solid color-mix(in oklab, var(--text) 4%, transparent);
    margin-top: 6px;
  }
  .clipgrid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 14px 14px;
  }
  .clipsq {
    min-width: 28px;
    padding: 3px 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-align: center;
    color: var(--text-faint);
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    border-radius: 3px;
  }
  .clipsq.on {
    color: var(--err);
    background: color-mix(in oklab, var(--err) 12%, transparent);
    border-color: color-mix(in oklab, var(--err) 50%, transparent);
    box-shadow: 0 0 6px color-mix(in oklab, var(--err) 40%, transparent);
  }
</style>

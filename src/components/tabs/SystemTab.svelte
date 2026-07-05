<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { connection } from '@/state';
  import DevicePanel from '@/components/system/DevicePanel.svelte';
  import InputConfigPanel from '@/components/system/InputConfigPanel.svelte';
  import OutputsPanel from '@/components/system/OutputsPanel.svelte';
  import I2sClockPanel from '@/components/system/I2sClockPanel.svelte';
  import LgSoundSyncPanel from '@/components/system/LgSoundSyncPanel.svelte';
  import DacHwMutePanel from '@/components/system/DacHwMutePanel.svelte';
  import ControlInterfacesPanel from '@/components/system/ControlInterfacesPanel.svelte';
  import BufferStatsPanel from '@/components/system/BufferStatsPanel.svelte';
  import { chKey } from '@/styles/palette';
  import { clearClips } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snap = $derived(s.mirror.current);
  const info = $derived(s.telemetry.info);
  const connected = $derived(connection.connected);
  const features = $derived(s.device.capabilities.features);

  function fmtNum(v: number | null | undefined): string { return v == null ? '—' : String(v); }
  function isNonZero(v: number | null | undefined): boolean { return v != null && v > 0; }
</script>

<div class="grid">
  <div class="col">
    <DevicePanel />
    <InputConfigPanel />
    <OutputsPanel />
  </div>

  <div class="col">
    <I2sClockPanel />
    <LgSoundSyncPanel />
    <DacHwMutePanel />
    {#if features.controlInterfaces}
      <ControlInterfacesPanel />
    {/if}
  </div>

  <div class="col">
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
        <KV label="POLL ERR"  value={String(s.telemetry.errorCount)} tone={s.telemetry.errorCount > 0 ? undefined : 'off'} />
      </div>
    </Panel>

    <Panel code="SY.04" title="ERROR COUNTERS">
      {#snippet right()}
        <button class="chip" onclick={() => clearClips(s)} disabled={!connected} title="Clear latched clip flags">CLEAR</button>
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
      <!-- Latch is a host-side OR over every 20 Hz status packet; CLEAR above
           resets both firmware (ClearClips 0x83) and the host array. -->
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

    <BufferStatsPanel />
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pad); height: 100%; }
  .col { display: flex; flex-direction: column; gap: var(--pad); min-height: 0; }

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
    background: var(--wash);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
  }
  .clipsq.on {
    color: var(--err);
    background: color-mix(in oklab, var(--err) 12%, transparent);
    border-color: color-mix(in oklab, var(--err) 50%, transparent);
    box-shadow: 0 0 6px color-mix(in oklab, var(--err) 40%, transparent);
  }
</style>

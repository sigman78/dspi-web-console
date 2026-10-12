<script lang="ts">
  import ProcPanel from './ProcPanel.svelte';
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import * as Domain from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { untrack } from 'svelte';

  const { Proc } = Domain;

  const s = getSession();

  // Full-scale of the GR bar; deeper reduction pins the bar.
  const GR_BAR_FULL_DB = 30;

  const LINK_OPTIONS = [
    { value: 0, label: '—' },
    { value: 1, label: '1' },
    { value: 2, label: '2' },
    { value: 3, label: '3' },
    { value: 4, label: '4' },
  ] as const;

  const snapshot = $derived(s.mirror.current);
  const outputs = $derived(Domain.outputChannelsWithIndex(snapshot));
  const limiter = $derived(snapshot?.limiter ?? []);
  const anyEnabled = $derived(outputs.some((o) => limiter[o.index]?.enabled));

  // Wire index of the row being edited; falls back to the first output when
  // the device (and so the output list) changes under it.
  let selectedIndex = $state(0);
  const selected = $derived(outputs.find((o) => o.index === selectedIndex) ?? outputs[0] ?? null);
  const sel = $derived(selected ? limiter[selected.index] : undefined);
  const editable = $derived(sel?.enabled ?? false);

  const meter = $derived(s.telemetry.limiterMeterDb);
  const status = $derived(s.telemetry.limiterStatus);
  const independent = $derived(s.presets.directory?.outputConfigMode === Domain.OutputConfigMode.Independent);
  const rateHz = $derived(s.telemetry.info?.sampleRateHz ?? 0);
  const lookaheadMs = $derived(
    status && rateHz > 0 ? ((status.lookaheadSamples / rateHz) * 1000).toFixed(2) : null,
  );

  function barPct(gr: number | undefined): number {
    return Math.round(Math.min(1, Math.max(0, (gr ?? 0) / GR_BAR_FULL_DB)) * 100);
  }

  function readout(gr: number | undefined): string {
    if (gr === undefined) return '—';
    return gr >= 0.05 ? `−${gr.toFixed(1)} dB` : '0.0 dB';
  }

  // Hold meter-poll interest while mounted (poll.ts limiterMeter cadence).
  $effect(() => {
    // untrack: wantLimiterMeter reads+writes the interest counter, which would
    // otherwise make this effect depend on its own write.
    return untrack(() => s.telemetry.wantLimiterMeter());
  });
</script>

<ProcPanel
  code="PR.07"
  title="LIMITER"
  subject="limiter"
  enabled={anyEnabled}
  onToggle={() => Runtime.setLimiterAllEnabled(s, !anyEnabled)}
>
  <div class="proc-grid">
    <div class="outputs" role="group" aria-label="Limiter outputs">
      {#each outputs as out (out.id)}
        {@const o = limiter[out.index]}
        {@const gr = meter?.[out.index]}
        <div class="orow" class:selected={selected?.index === out.index}>
          <ToggleSwitch
            size="sm"
            checked={o?.enabled ?? false}
            ariaLabel={`Limiter ${out.name}`}
            onChange={() => Runtime.setLimiterEnabled(s, out.index, !(o?.enabled ?? false))}
          />
          <button
            type="button"
            class="pick"
            aria-current={selected?.index === out.index ? 'true' : undefined}
            onclick={() => (selectedIndex = out.index)}
          >
            <span class="sr-only">Edit limiter </span>
            <span class="oname">{out.name}</span>
            <span class="gtag">{o && o.linkGroup > 0 ? `G${o.linkGroup}` : ''}</span>
            <span class="bar" aria-hidden="true">
              {#if meter}<span class="fill" style:width="{barPct(gr)}%"></span>{/if}
            </span>
            <span class="gr">{readout(gr)}</span>
          </button>
        </div>
      {/each}
    </div>

    {#if selected && sel}
      <div class="rule"></div>
      <span class="section">OUTPUT {selected.index + 1} · {selected.name}</span>

      <LabeledSlider
        label="THRESHOLD"
        ariaLabel="Limiter threshold"
        value={sel.thresholdDb}
        min={Proc.LIMITER_THRESHOLD_MIN_DB} max={Proc.LIMITER_THRESHOLD_MAX_DB} step={Proc.LIMITER_THRESHOLD_STEP_DB}
        kind="dB-signed"
        precision={1}
        disabled={!editable}
        onChange={(v) => Runtime.setLimiterThreshold(s, selected.index, v)}
      />

      <LabeledSlider
        label="RELEASE"
        ariaLabel="Limiter release"
        value={sel.releaseMs}
        min={Proc.LIMITER_RELEASE_MIN_MS} max={Proc.LIMITER_RELEASE_MAX_MS} step={Proc.LIMITER_RELEASE_STEP_MS}
        kind="ms"
        precision={0}
        disabled={!editable}
        onChange={(v) => Runtime.setLimiterRelease(s, selected.index, v)}
      />

      <span class="microlbl">LINK</span>
      <div class="span2">
        <SegmentedSelect
          size="sm"
          value={sel.linkGroup}
          options={LINK_OPTIONS}
          ariaLabel="Limiter link group"
          onChange={(v) => Runtime.setLimiterLinkGroup(s, selected.index, v)}
        />
        {#if sel.linkGroup > 0}
          <p class="hint">grouped outputs share enable, threshold and release</p>
        {/if}
      </div>
    {/if}

    <div class="rule"></div>
    <span class="microlbl">LOOKAHEAD</span>
    <span class="span2 lookahead">
      {#if !status}
        —
      {:else if status.engaged}
        engaged · +{status.lookaheadSamples} samples{lookaheadMs ? ` (${lookaheadMs} ms @ ${(rateHz / 1000).toFixed(1)} kHz)` : ''}
      {:else}
        off · no added latency
      {/if}
    </span>
    {#if independent}
      <span class="hint span2">device-global in independent mode — SAVE in SYSTEM › OUTPUTS to keep after a reboot</span>
    {/if}
  </div>
</ProcPanel>

<style>
  .outputs { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 2px; }
  .orow {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .orow.selected { background: var(--wash-strong); }

  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 2px 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .oname {
    flex: 0 0 auto;
    width: 84px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text);
  }
  .gtag {
    flex: 0 0 auto;
    width: 18px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    color: var(--accent);
  }
  .bar {
    flex: 1;
    height: 5px;
    border-radius: 2px;
    background: var(--wash-strong);
    overflow: hidden;
  }
  .bar .fill {
    display: block;
    height: 100%;
    background: var(--warn);
    transition: width 100ms;
  }
  .gr {
    flex: 0 0 auto;
    width: 56px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--text);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  .lookahead { font-family: var(--font-mono); font-size: 10px; color: var(--text); }
</style>

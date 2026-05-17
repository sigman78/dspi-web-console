<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import BodePlot, { type BodeCurve, type BodeMarker } from '../bode/BodePlot.svelte';
  import BandsPanel from '../eq/BandsPanel.svelte';
  import PreampPanel from '../eq/PreampPanel.svelte';
  import OutputTrim from '../eq/OutputTrim.svelte';
  import { mockEqCurve } from '../bode/bodeMock';
  import { filterCurve, filterCurveAt } from '../bode/filterCurve';
  import { dsp, settings, setEqTarget } from '@/state';
  import {
    eqUi,
    setEqCopySource,
    clearEqCopySource,
    applyCopyFrom,
  } from '../eq/eqUi.svelte';
  import { FilterType, defaultFilter, type FilterParams, inputIndexOf } from '@/domain';
  import { setEqFilter, setInputPreamp } from '@/runtime';

  const snap = $derived(dsp.live);

  // Auto-pick a default channel when entering the tab unselected.
  $effect(() => {
    if (settings.eqTarget != null) return;
    const first = snap?.outputs[0];
    if (first) setEqTarget(first.id);
  });

  const channel = $derived(
    settings.eqTarget != null ? snap?.channels.find((c) => c.id === settings.eqTarget) ?? null : null,
  );
  // Input preamp index for the selected channel; null if not an input.
  const inputIndex = $derived(channel ? inputIndexOf(channel.id) : null);
  const outputForChannel = $derived(
    channel?.isOutput ? snap?.outputs.find((o) => o.id === channel.id) ?? null : null,
  );
  const preampDb = $derived(
    inputIndex !== null ? (snap?.inputPreampDb[inputIndex] ?? 0) : 0,
  );
  const bands = $derived(channel?.filters ?? []);

  const curve = $derived.by<BodeCurve>(() => {
    if (!channel) {
      return mockEqCurve();
    }
    return {
      id: `eq-${channel.id}`,
      channelId: channel.id,
      points: filterCurve(bands, preampDb),
      label: channel.shortName,
    };
  });

  const markers = $derived.by<BodeMarker[]>(() => {
    if (!channel) return [];
    const out: BodeMarker[] = [];
    bands.forEach((b, i) => {
      if (b.type === FilterType.Flat) return;
      out.push({
        id: `m${i}`,
        f: b.frequency,
        db: filterCurveAt(bands, preampDb, b.frequency),
        channelId: channel.id,
        label: String(i + 1),
      });
    });
    return out;
  });

  function patchBand(i: number, patch: Partial<FilterParams>) {
    if (!channel) return;
    const next = { ...channel.filters[i], ...patch };
    setEqFilter(channel.id, i, next);
  }

  function reset() {
    if (!channel) return;
    for (let i = 0; i < channel.filters.length; i++) {
      setEqFilter(channel.id, i, defaultFilter());
    }
    // Preamp has its own reset action via PreampPanel's reset button.
  }

  function copy() {
    if (!channel) return;
    setEqCopySource(channel.id);
  }

  function paste() {
    if (!channel || eqUi.copySource == null) return;
    applyCopyFrom(eqUi.copySource, channel.id);
  }

  function exitCopy() {
    clearEqCopySource();
  }

  // Defensive: if the source channel disappears from the snapshot while
  // selection is armed, drop the source so the pulsation stops cleanly.
  $effect(() => {
    const src = eqUi.copySource;
    if (src == null) return;
    if (!snap?.channels.some((c) => c.id === src)) {
      clearEqCopySource();
    }
  });

  // Ephemeral mode: clear when leaving the EQ tab (component unmount).
  $effect(() => {
    return () => clearEqCopySource();
  });

  function setPreamp(v: number) {
    if (inputIndex === null) return;
    setInputPreamp(inputIndex, v);
  }
  function resetPreamp() {
    if (inputIndex === null) return;
    setInputPreamp(inputIndex, 0);
  }
</script>

<div class="grid">
  <div class="leftcol">
    <Panel
      code="EQ.01"
      title={channel ? `RESPONSE · ${channel.shortName} · ${channel.name}` : 'RESPONSE'}
    >
      {#snippet right()}
        {#if !channel}
          <span class="meta">SELECT CHANNEL ↑</span>
        {/if}
      {/snippet}
      <div class="bode-host">
        <BodePlot curves={[curve]} markers={markers} height={260} />
      </div>
    </Panel>
  </div>

  <div class="rightcol">
    {#if channel}
      <BandsPanel
        bands={channel.filters}
        onPatch={patchBand}
        onReset={reset}
        copySource={eqUi.copySource}
        currentChannel={channel.id}
        onCopy={copy}
        onPaste={paste}
        onExit={exitCopy}
      />
      {#if inputIndex !== null}
        <PreampPanel preampDb={preampDb} accentChannelId={channel.id} onChange={setPreamp} onReset={resetPreamp} />
      {:else if outputForChannel}
        <OutputTrim output={outputForChannel} />
      {/if}
    {:else}
      <Panel code="EQ.02" title="BANDS · 10 BIQUAD">
        <p class="hint">Pick a channel from the top-bar pin row to edit its EQ.</p>
      </Panel>
    {/if}
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 2fr minmax(0, 1fr);
    gap: var(--pad);
    height: 100%;
  }
  .leftcol, .rightcol {
    display: flex; flex-direction: column; gap: var(--pad); min-height: 0;
  }
  .meta {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1px;
  }
  .bode-host {
    padding: 12px 14px 4px;
  }
  .hint {
    padding: 16px 18px;
    margin: 0;
    font-family: var(--font-sans);
    color: var(--text-dim);
    font-size: 12px;
  }
</style>

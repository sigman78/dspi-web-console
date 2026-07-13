<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import BodePlot, { type BodeCurve, type BodeMarker } from '@/components/bode/BodePlot.svelte';
  import BandsPanel from '@/components/eq/BandsPanel.svelte';
  import XoverPanel from '@/components/eq/XoverPanel.svelte';
  import { offeredTypes } from '@/components/eq/BandTypeSelect.svelte';
  import PreampPanel from '@/components/eq/PreampPanel.svelte';
  import OutputTrim from '@/components/eq/OutputTrim.svelte';
  import AutoEqBrowser from '@/components/eq/AutoEqBrowser.svelte';
  import { mockEqCurve } from '@/components/bode/bodeMock';
  import { filterCurve, filterCurveAt } from '@/components/bode/filterCurve';
  import { settings, eqUi, setEqCopySource, clearEqCopySource } from '@/state';
  import { FilterType, defaultFilter, seedTypeChange, type FilterParams, inputIndexOf } from '@/domain';
  import { setEqFilter, setInputPreamp, copyEqBands, setBandBypass } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const snap = $derived(s.mirror.current);

  const channel = $derived(
    settings.selectedChannel != null ? snap?.channels.find((c) => c.id === settings.selectedChannel) ?? null : null,
  );
  // null when the selected channel is not an input.
  const inputIndex = $derived(channel ? inputIndexOf(channel.id) : null);
  const outputForChannel = $derived(
    channel?.isOutput ? snap?.outputs.find((o) => o.id === channel.id) ?? null : null,
  );
  const preampDb = $derived(
    inputIndex !== null ? (snap?.inputPreampDb[inputIndex] ?? 0) : 0,
  );
  const bands = $derived(channel?.filters ?? []);
  const libraryPreampDb = $derived(inputIndex !== null ? preampDb : (outputForChannel?.gainDb ?? 0));
  let libOpen = $state(false);
  const bandTypes = $derived(offeredTypes(s.device.capabilities.features));

  const curve = $derived.by<BodeCurve>(() => {
    if (!channel) {
      return mockEqCurve();
    }
    return {
      id: `eq-${channel.id}`,
      channelId: channel.id,
      points: filterCurve(bands, preampDb, channel.xoverBands),
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
        db: filterCurveAt(bands, preampDb, b.frequency, channel.xoverBands),
        channelId: channel.id,
        label: String(i + 1),
      });
    });
    channel.xoverBands.forEach((b, i) => {
      if (b.type === FilterType.Flat) return;
      out.push({
        id: `x${i}`,
        f: b.frequency,
        db: filterCurveAt(bands, preampDb, b.frequency, channel.xoverBands),
        channelId: channel.id,
        label: `X${i + 1}`,
      });
    });
    return out;
  });

  function patchBand(i: number, patch: Partial<FilterParams>) {
    if (!channel) return;
    if ('bypass' in patch && patch.bypass !== undefined) {
      setBandBypass(s, channel.id, i, patch.bypass);
    }
    // Send the non-bypass fields if there are any (type/freq/q/gain changes).
    const { bypass: _bypass, ...rest } = patch;
    if (Object.keys(rest).length === 0) return;
    const current = channel.filters[i];
    // A type switch may need to seed fields (see seedTypeChange's doc comment
    // -- Linkwitz Transform reinterprets the gain slot as fp).
    const seed = rest.type !== undefined ? seedTypeChange(current, rest.type) : {};
    setEqFilter(s, channel.id, i, { ...current, ...rest, ...seed });
  }

  function reset() {
    if (!channel) return;
    for (let i = 0; i < channel.filters.length; i++) {
      setEqFilter(s, channel.id, i, defaultFilter());
    }
    // Preamp has its own reset action via PreampPanel's reset button.
  }

  function copy() {
    if (!channel) return;
    setEqCopySource(channel.id);
  }

  function paste() {
    if (!channel || eqUi.copySource == null) return;
    copyEqBands(s, eqUi.copySource, channel.id);
  }

  function exitCopy() {
    clearEqCopySource();
  }

  // Drop the copy source if its channel disappears from the snapshot, so the
  // pulsation stops cleanly.
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
    setInputPreamp(s, inputIndex, v);
  }
  function resetPreamp() {
    if (inputIndex === null) return;
    setInputPreamp(s, inputIndex, 0);
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
          <span class="meta">SELECT CHANNEL ←</span>
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
        types={bandTypes}
        onLibrary={() => (libOpen = true)}
      />
      {#if inputIndex !== null}
        <PreampPanel preampDb={preampDb} accentChannelId={channel.id} onChange={setPreamp} onReset={resetPreamp} />
      {:else if outputForChannel}
        {#if s.device.capabilities.features.crossover && channel.xoverBands.length > 0}
          <XoverPanel {channel} />
        {/if}
        <OutputTrim output={outputForChannel} />
      {/if}
    {:else}
      <Panel code="EQ.02" title="BANDS · 10 BIQUAD">
        <p class="hint">Pick a channel from the rail on the left to edit its EQ.</p>
      </Panel>
    {/if}
  </div>
</div>

{#if libOpen && channel}
  <AutoEqBrowser {channel} preampDb={libraryPreampDb} onClose={() => (libOpen = false)} />
{/if}

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

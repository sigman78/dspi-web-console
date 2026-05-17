<script lang="ts">
  import MiniPin from './MiniPin.svelte';
  import { settings, setTab, setEqTarget, TAB_ORDER, type TabId, dsp, status } from '@/state';
  import { eqUi } from '../eq/eqUi.svelte';
  import type { ChannelModel, ChannelId } from '@/domain';

  const TAB_META: Record<TabId, { label: string; code: string }> = {
    overview:   { label: 'OVERVIEW',   code: '01' },
    eq:         { label: 'EQUALIZER',  code: '02' },
    mixer:      { label: 'MIXER',      code: '03' },
    processing: { label: 'PROCESSING', code: '04' },
    presets:    { label: 'PRESETS',    code: '05' },
    system:     { label: 'SYSTEM',     code: '06' },
  };

  const TABS = TAB_ORDER.map((id) => ({ id, ...TAB_META[id] }));

  const inputs = $derived(dsp.live?.channels.filter((c) => !c.isOutput) ?? []);
  const outputs = $derived(dsp.live?.channels.filter((c) =>  c.isOutput) ?? []);
  const selectable = $derived(settings.tab === 'eq');

  function levelDb(ch: ChannelModel): number {
    const p = status.peaks[ch.id] ?? 0;
    return p > 0 ? 20 * Math.log10(p) : -60;
  }

  function isDim(ch: ChannelModel): boolean {
    if (!dsp.live) return true;
    if (!ch.isOutput) return false;
    const out = dsp.live.outputs.find((o) => o.id === ch.id);
    return !out || !out.enabled;
  }

  function pickEq(id: ChannelId) {
    if (!selectable) return;
    setEqTarget(id);
  }

  // L/R suffix on the displayed shortName drives the visual pairing.
  // PDM and any future singleton fall through to 'single'.
  function pairSide(short: string): 'left' | 'right' | 'single' {
    if (short.endsWith('L')) return 'left';
    if (short.endsWith('R')) return 'right';
    return 'single';
  }
</script>

<div class="tabs">
  <div class="row">
    {#each TABS as t (t.id)}
      <button
        class="tab"
        class:active={settings.tab === t.id}
        onclick={() => setTab(t.id)}
      >
        <span class="tcode">{t.code}</span>
        <span class="tlabel">{t.label}</span>
      </button>
    {/each}

    <span class="div"></span>

    <div class="pinrow">
      {#each inputs as ch (ch.id)}
        <MiniPin
          id={ch.shortName}
          name={ch.name}
          channelId={ch.id}
          levelDb={levelDb(ch)}
          dim={isDim(ch)}
          selectable={selectable}
          active={selectable && settings.eqTarget === ch.id}
          pulsate={selectable && eqUi.copySource === ch.id}
          clipped={status.clipLatched[ch.id]}
          pairSide={pairSide(ch.shortName)}
          onclick={() => pickEq(ch.id)}
        />
      {/each}
    </div>
    <span class="arrow">→</span>
    <div class="pinrow grow">
      {#each outputs as ch (ch.id)}
        <MiniPin
          id={ch.shortName}
          name={ch.name}
          channelId={ch.id}
          levelDb={levelDb(ch)}
          dim={isDim(ch)}
          selectable={selectable}
          active={selectable && settings.eqTarget === ch.id}
          pulsate={selectable && eqUi.copySource === ch.id}
          clipped={status.clipLatched[ch.id]}
          pairSide={pairSide(ch.shortName)}
          onclick={() => pickEq(ch.id)}
        />
      {/each}
    </div>

    {#if selectable}
      <span class="hint">← EQ TARGET</span>
    {/if}
  </div>
</div>

<style>
  .tabs {
    background: color-mix(in oklab, var(--bg) 70%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--border);
  }
  .row {
    padding: 0 16px;
    display: flex;
    align-items: stretch;
    gap: 14px;
    font-family: var(--font-mono);
  }
  .tab {
    padding: 10px 12px;
    border-radius: 0;
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: 10px;
    letter-spacing: 1.2px;
    font-weight: 600;
    cursor: pointer;
    display: flex; gap: 6px; align-items: baseline;
    transition: background 100ms, color 100ms, box-shadow 100ms;
  }
  .tab.active {
    background:
      linear-gradient(to top,
        color-mix(in oklab, var(--accent) 25%, transparent) 0%,
        color-mix(in oklab, var(--accent) 10%, transparent) 40%,
        color-mix(in oklab, var(--accent) 6%, transparent) 100%),
      color-mix(in oklab, var(--accent) 8%, transparent);
    color: var(--accent);
    box-shadow:
      inset 0 -2px 0 0 var(--accent),
      inset 0 -10px 16px -6px color-mix(in oklab, var(--accent) 28%, transparent);
  }
  .tcode { color: var(--text-faint); font-size: 9px; }
  .tlabel { font-size: 10px; }
  .tab.active .tcode { color: color-mix(in oklab, var(--accent) 70%, transparent); }
  .div { width: 1px; height: 22px; align-self: center; background: var(--border); margin: 0 4px; }
  .pinrow { display: flex; gap: 4px; align-items: center; }
  .pinrow.grow { flex: 1; overflow: hidden; }
  .arrow { font-size: 9px; color: var(--text-faint); letter-spacing: 1px; align-self: center; }
  .hint {
    font-size: 9px;
    color: var(--accent);
    letter-spacing: 1px;
    font-weight: 600;
    align-self: center;
  }
</style>

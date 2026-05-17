<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import ValueField from '../chrome/ValueField.svelte';
  import { Eq, type ChannelId } from '../../domain';
  import { chKey } from '../../styles/palette';

  const {
    preampDb,
    accentChannelId,
    onChange,
    onReset,
  }: {
    preampDb: number;
    accentChannelId: ChannelId;
    onChange: (db: number) => void;
    onReset: () => void;
  } = $props();

  const min = Eq.PREAMP_MIN_DB;
  const max = Eq.PREAMP_MAX_DB;
  const range = max - min;
  // Tick positions in % across the slider track. Includes 0 (the unity line).
  const ticks = Eq.PREAMP_TICKS_DB;
  const fillPct = $derived(((preampDb - min) / range) * 100);
</script>

<Panel code="EQ.03" title="PREAMP">
  {#snippet right()}
    <button class="reset" onclick={onReset} title="Reset preamp to 0 dB">RESET</button>
  {/snippet}

  <div class="row">
    <div
      class="track"
      role="slider"
      tabindex="0"
      aria-label="EQ preamp"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={preampDb}
      onpointerdown={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        const setFromEvent = (ev: PointerEvent) => {
          const r = el.getBoundingClientRect();
          const t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
          onChange(min + t * range);
        };
        el.setPointerCapture(e.pointerId);
        setFromEvent(e);
        const move = (ev: PointerEvent) => setFromEvent(ev);
        const up = (ev: PointerEvent) => {
          el.releasePointerCapture(ev.pointerId);
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
    >
      {#each ticks as t (t)}
        {@const pct = ((t - min) / range) * 100}
        <div class="tick" class:zero={t === 0} style:left="{pct}%"></div>
      {/each}
      <div class="fill ch-{chKey(accentChannelId)}" style:width="{fillPct}%"></div>
    </div>
    <div class="value">
      <ValueField
        kind="dB-signed"
        value={preampDb}
        min={min}
        max={max}
        step={Eq.PREAMP_STEP_DB}
        tone="signed"
        align="right"
        onChange={onChange}
      />
    </div>
  </div>
</Panel>

<style>
  .reset {
    border: 1px solid var(--border-hi);
    background: transparent;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 1px;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .reset:hover { background: color-mix(in oklab, var(--text) 6%, transparent); color: var(--text); }

  .row {
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .track {
    flex: 1;
    height: 22px;
    position: relative;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  .tick {
    position: absolute;
    top: 0; bottom: 0;
    width: 1px;
    background: color-mix(in oklab, var(--text) 8%, transparent);
    pointer-events: none;
  }
  .tick.zero { background: color-mix(in oklab, var(--text) 25%, transparent); }
  .fill {
    position: absolute;
    top: 1px; bottom: 1px;
    left: 0;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--ch-glow) 33%, transparent));
    border-right: 2px solid var(--ch-glow);
  }
  .value { width: 96px; }
</style>

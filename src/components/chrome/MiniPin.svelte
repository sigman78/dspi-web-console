<script lang="ts">
  import { chKey } from '../../styles/palette';
  import type { ChannelId } from '../../domain/channels';

  const {
    id,
    name,
    channelId,
    levelDb,
    dim = false,
    selectable = false,
    active = false,
    pulsate = false,
    clipped = false,
    pairSide = 'single',
    onclick,
  }: {
    id: string;
    name: string;
    channelId: ChannelId;
    levelDb: number;
    dim?: boolean;
    selectable?: boolean;
    active?: boolean;
    pulsate?: boolean;
    clipped?: boolean;
    pairSide?: 'left' | 'right' | 'single';
    onclick?: () => void;
  } = $props();

  const pct = $derived(Math.max(0, Math.min(1, (levelDb + 60) / 60)));
  const meterColor = $derived(
    pct > 0.92 ? 'var(--err)'
      : pct > 0.75 ? 'var(--warn)'
      : 'var(--text)'
  );
</script>

{#if selectable}
  <button
    class="pin ch-{chKey(channelId)} pair-{pairSide}"
    class:active
    class:dim
    class:pulsate
    title="{id} · {name}"
    onclick={onclick}
  >
    <div class="row">
      <span class="id">{id}</span>
      <span class="db">{dim ? '—' : levelDb.toFixed(0)}</span>
    </div>
    <div class="track">
      <div class="fill" style:width="{pct * 100}%" style:background={meterColor}></div>
    </div>
    <div class="clipline" class:on={clipped} aria-label={clipped ? 'clipped' : undefined} title={clipped ? `${id} · CLIPPED` : undefined}></div>
  </button>
{:else}
  <div
    class="pin ch-{chKey(channelId)} pair-{pairSide}"
    class:dim
    class:pulsate
    title="{id} · {name}"
  >
    <div class="row">
      <span class="id">{id}</span>
      <span class="db">{dim ? '—' : levelDb.toFixed(0)}</span>
    </div>
    <div class="track">
      <div class="fill" style:width="{pct * 100}%" style:background={meterColor}></div>
    </div>
    <div class="clipline" class:on={clipped} aria-label={clipped ? 'clipped' : undefined} title={clipped ? `${id} · CLIPPED` : undefined}></div>
  </div>
{/if}

<style>
  .pin {
    min-width: 56px;
    padding: 3px 6px;
    border-radius: 3px;
    background: var(--ch-base);
    border: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    cursor: default;
    color: inherit;
    text-align: left;
    font-family: var(--font-mono);
    transition: background 100ms, box-shadow 100ms;
  }
  button.pin { cursor: pointer; }
  /* Pair shaping: L/R siblings sit ~1px apart with their joining edges
     squared off, so a stereo pair reads as one unit. The pinrow's 4px
     flex-gap is reduced via a negative margin on the right half. */
  .pin.pair-left {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .pin.pair-right {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    margin-left: -3px;
  }
  .pin.dim {
    background:
      repeating-linear-gradient(
        135deg,
        color-mix(in oklab, var(--bg) 45%, transparent) 0 2px,
        transparent 2px 5px
      ),
      color-mix(in oklab, var(--ch-base) 75%, var(--bg));
  }
  .pin.active {
    background: var(--ch-base);
    box-shadow: inset 0 0 0 2px var(--text);
  }
  .pin.pulsate {
    animation: pin-pulse 2s ease-in-out infinite;
  }
  @keyframes pin-pulse {
    0%, 100% { background: var(--ch-base); }
    50%      { background: color-mix(in oklab, var(--ch-base) 55%, var(--text) 45%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pin.pulsate {
      animation: none;
      background: color-mix(in oklab, var(--ch-base) 70%, var(--text) 30%);
    }
  }
  .row { display: flex; justify-content: space-between; align-items: center; }
  .id { font-size: 9px; font-weight: 800; color: var(--bg); }
  .db { font-size: 9px; font-weight: 600; color: color-mix(in oklab, var(--bg) 70%, transparent); }
  .track {
    height: 2px;
    background: color-mix(in oklab, var(--bg) 30%, transparent);
    border-radius: 1px;
    overflow: hidden;
  }
  .fill { height: 100%; transition: width 80ms linear; }
  /* Latched clip indicator: a 1px pure-red underline below the meter.
     Always rendered (transparent off, red on) so toggling clip state
     doesn't shift surrounding layout. */
  .clipline {
    height: 1px;
    margin-top: 1px;
    background: transparent;
    border-radius: 1px;
    pointer-events: none;
  }
  .clipline.on { background: #ff0000; }
</style>

<script lang="ts">
  import { chKey } from '@/styles/palette';
  import type { ChannelId } from '@/domain';

  const {
    name,
    channelId,
    levelDb,
    selected = false,
    dim = false,
    pulsate = false,
    clipped = false,
    disabled = false,
    onclick,
  }: {
    name: string;
    channelId: ChannelId;
    levelDb: number;
    selected?: boolean;
    dim?: boolean;
    pulsate?: boolean;
    clipped?: boolean;
    disabled?: boolean;
    onclick?: () => void;
  } = $props();

  const pct = $derived(Math.max(0, Math.min(1, (levelDb + 60) / 60)));
  const warm = $derived(pct > 0.75 && pct <= 0.92);
  const hot = $derived(pct > 0.92);

  function handleClick() {
    if (!disabled) onclick?.();
  }
</script>

<button
  class="row ch-{chKey(channelId)}"
  class:selected
  class:dim
  class:pulsate
  {disabled}
  aria-pressed={selected}
  title={name}
  onclick={handleClick}
>
  <span class="nm">{name}</span>
  <span class="track">
    <span class="fill" class:warm class:hot style:width="{pct * 100}%"></span>
  </span>
  <span class="clipline" class:on={clipped}></span>
</button>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: color-mix(in oklab, var(--text) 3%, transparent);
    color: var(--text);
    font-family: var(--font-mono);
    text-align: left;
    cursor: pointer;
    transition: background 100ms, border-color 100ms, box-shadow 100ms;
  }
  .row:hover:not(:disabled) {
    border-color: var(--border-hi);
    background: color-mix(in oklab, var(--text) 7%, transparent);
  }
  .row:disabled { cursor: default; }
  .nm {
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track {
    height: 4px;
    background: color-mix(in oklab, var(--text) 12%, transparent);
    border-radius: 2px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--ch-bright);
    border-radius: 2px;
    transition: width 80ms linear;
  }
  .fill.warm { background: var(--warn); }
  .fill.hot { background: var(--err); }

  /* Selected: the channel's hue fills the button; text flips to bg contrast. */
  .row.selected {
    background: var(--ch-base);
    border-color: var(--ch-base);
  }
  .row.selected .nm { color: var(--bg); font-weight: 600; }
  .row.selected .track { background: color-mix(in oklab, var(--bg) 22%, transparent); }
  .row.selected .fill { background: var(--bg); }
  .row.selected .fill.warm { background: var(--warn); }
  .row.selected .fill.hot { background: var(--err); }

  .row.dim .nm { opacity: 0.5; }
  .row.pulsate { animation: row-pulse 2s ease-in-out infinite; }
  @keyframes row-pulse {
    0%, 100% { background: color-mix(in oklab, var(--text) 3%, transparent); }
    50%      { background: color-mix(in oklab, var(--ch-base) 45%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .row.pulsate { animation: none; background: color-mix(in oklab, var(--ch-base) 35%, transparent); }
  }

  /* Latched clip indicator: 1px red underline, always present to avoid reflow. */
  .clipline {
    height: 1px;
    background: transparent;
    border-radius: 1px;
    pointer-events: none;
  }
  .clipline.on { background: #ff0000; }
</style>

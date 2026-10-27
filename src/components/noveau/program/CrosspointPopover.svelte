<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { Mix, type InputSlot, type OutputSlot } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import RangeField from '../tune/RangeField.svelte';

  const {
    input,
    output,
    title,
    proposal,
    x,
    anchorX,
    y,
    boundsW,
    boundsH,
    onClose,
  }: {
    input: InputSlot;
    output: OutputSlot;
    title: string;
    /** Decided at open: edits stay in a local draft until ROUTE applies them. */
    proposal: boolean;
    /** Anchor point and the box it must stay inside, in the routing container's coordinates. */
    x: number;
    /** Centre of the anchor dot, for the caret. */
    anchorX: number;
    y: number;
    boundsW: number;
    boundsH: number;
    onClose: () => void;
  } = $props();

  const s = getSession();
  const route = $derived(
    s.mirror.current?.routes.find((r) => r.inputIndex === input && r.outputWireIndex === output),
  );
  const enabled = $derived(route?.enabled ?? false);
  // Draft defaults come from the stored route at open time.
  let draftGain = $state(untrack(() => route?.gainDb ?? 0));
  let draftInvert = $state(untrack(() => route?.invert ?? false));
  const gain = $derived(proposal ? draftGain : (route?.gainDb ?? 0));
  const invert = $derived(proposal ? draftInvert : (route?.invert ?? false));

  let el = $state<HTMLDivElement | null>(null);
  let w = $state(0);
  let h = $state(0);
  const left = $derived(Math.max(0, Math.min(x, boundsW - w)));
  const top = $derived(Math.max(0, Math.min(y, boundsH - h)));
  const caretX = $derived(Math.max(10, Math.min(w - 10, anchorX - left)));
  const clamped = $derived(top !== y);

  function commitRoute() {
    Runtime.routeCrosspoint(s, input, output, { gainDb: draftGain, invert: draftInvert });
    onClose();
  }

  function unroute() {
    Runtime.setCrosspointEnabled(s, input, output, false);
    onClose();
  }

  onMount(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (el && !el.contains(t) && !t.closest?.('.dotbtn')) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if ((e.target as Element | null)?.closest?.('input:not([type=range]), textarea, .vf')) return;
      onClose();
    };
    el?.querySelector<HTMLElement>('button:not(.x), input')?.focus();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  });
</script>

<div class="pop" bind:this={el} bind:offsetWidth={w} bind:offsetHeight={h} role="dialog" aria-label={`Crosspoint ${title}`} style:left="{left}px" style:top="{top}px">
  {#if !clamped}<span class="caret" style:left="{caretX}px" aria-hidden="true"></span>{/if}
  <div class="ph">
    <h3>{title}</h3>
    <span class="cap">{proposal ? 'new route · Esc cancels' : 'crosspoint · Esc closes'}</span>
    <button type="button" class="x" aria-label="Close" onclick={onClose}>×</button>
  </div>
  <div class="r">
    <RangeField
      label="GAIN"
      value={gain}
      min={Mix.CROSSPOINT_GAIN_MIN_DB}
      max={Mix.CROSSPOINT_GAIN_MAX_DB}
      step={0.1}
      kind="dB-signed"
      tone="signed"
      disabled={!proposal && !enabled}
      onCommit={(v) => (proposal ? (draftGain = v) : Runtime.setCrosspointGain(s, input, output, v))}
    />
  </div>
  <div class="r">
    <span class="lbl">PHASE</span>
    <ToggleSwitch size="sm" checked={invert} disabled={!proposal && !enabled} ariaLabel="Invert phase" onChange={(v) => (proposal ? (draftInvert = v) : Runtime.setCrosspointInvert(s, input, output, v))} />
    <span class="cap">{invert ? 'inverted' : 'normal'}</span>
  </div>
  <div class="r foot">
    {#if proposal}
      <button type="button" class="chip accent act" onclick={commitRoute}>ROUTE</button>
      <button type="button" class="chip act" onclick={onClose}>CANCEL</button>
    {:else}
      <button type="button" class="chip act" disabled={!enabled} onclick={unroute}>UNROUTE</button>
    {/if}
  </div>
</div>

<style>
  .pop {
    position: absolute;
    z-index: 5;
    width: 300px;
    padding: 0 12px 4px;
    box-sizing: border-box;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-s);
    box-shadow: 0 4px 14px oklch(0% 0 0 / 0.4);
  }
  .caret {
    position: absolute;
    top: -5px;
    width: 8px; height: 8px;
    margin-left: -4px;
    box-sizing: border-box;
    background: var(--panel-solid);
    border-top: 1px solid var(--border-hi);
    border-left: 1px solid var(--border-hi);
    transform: rotate(45deg);
    pointer-events: none;
  }
  .ph { display: flex; align-items: center; gap: 8px; height: 28px; }
  .ph h3 { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .x {
    flex: none;
    width: 20px; height: 20px;
    padding: 0;
    display: grid; place-items: center;
    border: none;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text-dim);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .x:hover { color: var(--text); background: var(--wash-strong); }
  .x:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  h3 { margin: 0; font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--text); }
  .cap { flex: none; white-space: nowrap; font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); }
  .r {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 24px;
    border-top: 1px solid var(--border);
    --rf-label: 52px;
    --rf-value: 72px;
    --rf-track: 100px;
    --rf-track-flex: 0 0 auto;
  }
  .r :global(.rf) { gap: 12px; height: 22px; }
  .foot { gap: 6px; }
  .act { height: 20px; padding: 0 8px; font-size: 11px; }
  .chip:not(.accent).act { color: var(--text-dim); }
  .lbl { flex: 0 0 52px; font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); }
</style>

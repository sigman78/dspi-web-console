<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { Mix, type InputSlot, type OutputSlot } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import SliderField from '@/components/chrome/SliderField.svelte';
  import { clampToBounds, dismiss, registerLayer } from '@/components/chrome/dismiss';

  const {
    input,
    output,
    title,
    proposal,
    x,
    anchorX,
    y,
    yAbove,
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
    /** Top edge when placed below the anchor. */
    y: number;
    /** Bottom edge when there is no room below; the popover flips above it if that fits. */
    yAbove?: number;
    boundsW: number;
    boundsH: number;
    /** `refocus` is false for an outside click, which should leave focus where the user put it. */
    onClose: (refocus: boolean) => void;
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
  const above = $derived(yAbove !== undefined && h > 0 && y + h > boundsH && yAbove - h >= 0);
  const pos = $derived(clampToBounds(x, above ? yAbove! - h : y, w, h, boundsW, boundsH));
  const caretX = $derived(Math.max(10, Math.min(w - 10, anchorX - pos.left)));

  function commitRoute() {
    Runtime.routeCrosspoint(s, input, output, { gainDb: draftGain, invert: draftInvert });
    onClose(true);
  }

  function unroute() {
    Runtime.setCrosspointEnabled(s, input, output, false);
    onClose(true);
  }

  onMount(() => {
    el?.querySelector<HTMLElement>('button:not(.x-btn), input')?.focus();
    return registerLayer((e) => {
      onClose(true);
      e.preventDefault();
    });
  });
</script>

<div class="pop" bind:this={el} bind:offsetWidth={w} bind:offsetHeight={h} role="dialog" aria-label={`Crosspoint ${title}`} style:left="{pos.left}px" style:top="{pos.top}px" use:dismiss={{ onDismiss: () => onClose(false), escape: false, ignore: '.dotbtn' }}>
  {#if !pos.clamped}<span class="caret" class:below={above} style:left="{caretX}px" aria-hidden="true"></span>{/if}
  <div class="ph sec-h">
    <h3>{title}</h3>
    {#if proposal}
      <span class="tag">NEW</span>
    {:else}
      <button type="button" class="x-btn close" aria-label="Close" onclick={() => onClose(true)}>✕</button>
    {/if}
  </div>
  <SliderField
    lane="gesture"
    holdKey={`${input}:${output}`}
    label="GAIN"
    value={gain}
    min={Mix.CROSSPOINT_GAIN_MIN_DB}
    max={Mix.CROSSPOINT_GAIN_MAX_DB}
    step={0.1}
    kind="dB-signed"
    tone="signed"
    disabled={!proposal && !enabled}
    onChange={(v) => (proposal ? (draftGain = v) : Runtime.setCrosspointGain(s, input, output, v))}
  />
  <div class="prow">
    <span class="prow-lbl">PHASE</span>
    <ToggleSwitch checked={invert} disabled={!proposal && !enabled} ariaLabel="Invert phase" onChange={(v) => (proposal ? (draftInvert = v) : Runtime.setCrosspointInvert(s, input, output, v))} />
    <span class="t-cap">{invert ? 'inverted' : 'normal'}</span>
  </div>
  <div class="prow foot" class:live={!proposal}>
    {#if proposal}
      <button type="button" class="chip accent act" onclick={commitRoute}>ROUTE</button>
      <button type="button" class="chip act" onclick={() => onClose(true)}>CANCEL</button>
    {:else}
      <button type="button" class="chip act danger" title="Remove this route" onclick={unroute}>UNROUTE</button>
    {/if}
  </div>
</div>

<style>
  .pop {
    position: absolute;
    z-index: var(--z-pop);
    width: 300px;
    padding: 0 12px 4px;
    box-sizing: border-box;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-s);
    box-shadow: var(--shadow-pop);
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
  .caret.below {
    top: auto;
    bottom: -5px;
    border-top: none;
    border-left: none;
    border-bottom: 1px solid var(--border-hi);
    border-right: 1px solid var(--border-hi);
  }
  .ph { padding: 0; gap: 8px; }
  .ph h3 { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pop :global(.prow) { --rf-label: 52px; --rf-track: 100px; }
  .foot { gap: 6px; }
  .foot.live { justify-content: flex-end; }
  .tag {
    flex: none;
    padding: 0 6px;
    height: 18px;
    line-height: 18px;
    border-radius: var(--radius-s);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--accent);
    background: color-mix(in oklab, var(--accent) var(--tint), transparent);
  }
  .danger:hover:not(:disabled) {
    color: var(--err);
    border-color: color-mix(in oklab, var(--err) var(--tint-edge), transparent);
    background: color-mix(in oklab, var(--err) var(--tint), transparent);
  }
  .chip:not(.accent).act { color: var(--text-dim); }
</style>

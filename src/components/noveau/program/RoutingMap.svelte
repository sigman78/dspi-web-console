<script lang="ts">
  import { matrixRows, type InputSlot, type OutputSlot, type RouteModel } from '@/domain';
  import { selectChannel, settings } from '@/state';
  import { chShade } from '@/styles/palette';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '../noveauUi.svelte';
  import { fmtSigned } from './chainModel';
  import { upmixStatus } from './upmixStatus';
  import CrosspointPopover from './CrosspointPopover.svelte';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const features = $derived(s.device.capabilities.features);
  const upmixOn = $derived(features.upmix && snap?.upmix ? snap.upmix : null);

  const cols = $derived(
    matrixRows(
      snap,
      s.telemetry.activeInputChannels,
      upmixOn ? { enabled: upmixOn.enabled, surroundMode: upmixOn.surroundMode } : null,
    ).map((r) => ({
      input: r.inputIndex,
      id: r.inputId,
      label: r.label,
      short: snap?.channels.find((c) => c.id === r.inputId)?.shortName ?? r.label,
    })),
  );

  // Disabled outputs have no matrix column but keep their crosspoints.
  const rows = $derived(
    [...(snap?.outputs ?? [])]
      .sort((a, b) => a.wireIndex - b.wireIndex)
      .map((o) => ({
        slot: o.wireIndex,
        id: o.id,
        enabled: o.enabled,
        name: snap?.channels.find((c) => c.id === o.id)?.name ?? o.shortName,
      })),
  );

  const routeAt = (input: InputSlot, output: OutputSlot): RouteModel | undefined =>
    snap?.routes.find((r) => r.inputIndex === input && r.outputWireIndex === output);

  const caption = $derived.by(() => {
    if (!upmixOn) return 'outputs as rows · inputs as columns · click a dot to edit';
    const st = upmixStatus(upmixOn.enabled, s.telemetry.activeInputChannels, s.telemetry.info?.sampleRateHz ?? null);
    return `upmix ${st === 'active' ? 'active' : `parked — ${st}`} · click a dot to edit`;
  });

  let host = $state<HTMLElement | null>(null);
  let hostW = $state(0);
  let hostH = $state(0);
  let pick = $state<{ input: InputSlot; output: OutputSlot; x: number; anchorX: number; y: number; anchor: HTMLElement } | null>(null);

  function open(e: MouseEvent, input: InputSlot, output: OutputSlot) {
    if (!host) return;
    if (routeAt(input, output)?.enabled !== true) Runtime.setCrosspointEnabled(s, input, output, true);
    const anchor = e.currentTarget as HTMLElement;
    const dot = anchor.getBoundingClientRect();
    const box = host.getBoundingClientRect();
    pick = { input, output, x: dot.left - box.left + dot.width / 2 - 150, anchorX: dot.left - box.left + dot.width / 2, y: dot.bottom - box.top + 6, anchor };
  }

  function closePick() {
    const anchor = pick?.anchor;
    pick = null;
    anchor?.focus();
  }

  const pickCol = $derived(pick ? cols.find((c) => c.input === pick!.input) : undefined);
  const pickRow = $derived(pick ? rows.find((r) => r.slot === pick!.output) : undefined);

  $effect(() => {
    if (pick && (!pickCol || !pickRow)) pick = null;
  });

  function openOutput(id: (typeof rows)[number]['id']) {
    selectChannel(id);
    noveauUi.destination = 'tune';
  }
</script>

<section class="routing" data-budget bind:this={host} bind:clientWidth={hostW} bind:clientHeight={hostH} aria-label="Routing">
  <header>
    <h2>Routing</h2>
    <span class="cap">{caption}</span>
  </header>
  <div class="map" style:--n={cols.length}>
    <span></span>
    {#each cols as c (c.input)}
      <span class="ch" title={c.label}><i style:background={chShade(c.id, 'bright')}></i>{c.short}</span>
    {/each}
    {#each rows as r, ri (r.slot)}
      {#if !r.enabled}<span class="band" style:grid-row={ri + 2} aria-hidden="true"></span>{/if}
      <button
        type="button"
        class="rh"
        class:off={!r.enabled}
        style:grid-row={ri + 2}
        class:sel={settings.selectedChannel === r.id}
        title={r.enabled ? `Open ${r.name} in TUNE` : `${r.name} (disabled) — open in TUNE`}
        onclick={() => openOutput(r.id)}
      ><i style:background={chShade(r.id, 'bright')}></i><span>{r.name}</span></button>
      {#each cols as c, ci (c.input)}
        {@const rt = routeAt(c.input, r.slot)}
        {@const on = rt?.enabled === true}
        {@const anchored = pick?.input === c.input && pick?.output === r.slot}
        <span class="cell" class:off={!r.enabled} style:grid-row={ri + 2} style:grid-column={ci + 2}>
          <button
            type="button"
            class="dotbtn"
            aria-label={`${c.label} to ${r.name}${on ? `, ${fmtSigned(rt!.gainDb)} dB${rt!.invert ? ', inverted' : ''}` : ', unrouted'}`}
            onclick={(e) => open(e, c.input, r.slot)}
          >
            {#if on}
              <i class="pill" class:anchor={anchored} style:background={chShade(c.id, 'bright')}>{rt!.invert ? '⌽' : ''}{fmtSigned(rt!.gainDb)}</i>
            {:else}
              <i class="ring" class:anchor={anchored}></i>
            {/if}
          </button>
        </span>
      {/each}
    {/each}
  </div>
  <footer class="legend">
    <span><i class="pill sample">0.0</i>routed · gain</span>
    <span><i class="pill sample">⌽−3.0</i>inverted</span>
    <span><i class="ring"></i>unrouted</span>
    <span><i class="swatch"></i>disabled output</span>
  </footer>

  {#if pick && pickCol && pickRow}
    <CrosspointPopover
      input={pick.input}
      output={pick.output}
      title={`${pickCol.label} → ${pickRow.name}`}
      x={pick.x}
      anchorX={pick.anchorX}
      y={pick.y}
      boundsW={hostW}
      boundsH={hostH}
      onClose={closePick}
    />
  {/if}
</section>

<style>
  .routing {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  header {
    height: 28px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h2 { margin: 0; font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--text); }
  .cap { font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .map {
    display: grid;
    grid-template-columns: 150px repeat(var(--n), minmax(36px, 1fr));
    grid-template-rows: 24px;
    grid-auto-rows: 28px;
    min-height: 0;
    font-family: var(--font-sans);
    font-size: 11px;
  }
  .map > * { display: flex; align-items: center; justify-content: center; min-width: 0; }
  .ch { gap: 4px; font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
  .ch i { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .rh {
    justify-content: flex-start;
    gap: 8px;
    padding: 0;
    border: none;
    border-top: 1px solid var(--border);
    background: none;
    color: var(--text-dim);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    grid-column: 1;
  }
  .rh i { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .rh span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rh:hover, .rh.sel { color: var(--text); }
  .rh.off { color: var(--text-faint); }
  /* One continuous hatch per disabled row, behind the transparent header and cells. */
  .band {
    grid-column: 1 / -1;
    pointer-events: none;
    background: repeating-linear-gradient(135deg, var(--wash-strong) 0 3px, transparent 3px 7px);
  }
  .cell { border-top: 1px solid var(--border); }
  .dotbtn {
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .dotbtn:hover .ring { opacity: 1; border-color: var(--accent); }
  .dotbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .ring { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--border-hi); opacity: 0.8; box-sizing: border-box; }
  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 18px;
    padding: 0 4px;
    border-radius: 9px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--bg);
    white-space: nowrap;
  }
  .pill.sample { background: var(--text-dim); min-width: 30px; }
  .pill.anchor, .ring.anchor { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--accent); }
  .legend {
    flex: none;
    margin-top: auto;
    height: 24px;
    display: flex;
    align-items: center;
    gap: 14px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-faint);
  }
  .legend span { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .swatch { display: inline-block; width: 12px; height: 10px; background: repeating-linear-gradient(135deg, var(--wash-strong) 0 3px, transparent 3px 7px); }
</style>

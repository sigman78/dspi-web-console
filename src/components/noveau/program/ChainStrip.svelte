<script lang="ts">
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '../noveauUi.svelte';
  import { selectChannel, settings } from '@/state';
  import { chainBlocks, type ChainBlock } from './chainModel';
  import { resolveModule, type ProgramModuleKey } from './programModel';

  const s = getSession();
  const blocks = $derived(
    chainBlocks(s.mirror.current, s.device.capabilities.features, {
      activeInputChannels: s.telemetry.activeInputChannels,
      sampleRateHz: s.telemetry.info?.sampleRateHz ?? null,
    }),
  );

  const SETTERS: Partial<Record<ProgramModuleKey, (v: boolean) => void>> = {
    leveller: (v) => Runtime.setLevellerEnabled(s, v),
    crossfeed: (v) => Runtime.setCrossfeedEnabled(s, v),
    loudness: (v) => Runtime.setLoudnessEnabled(s, v),
    psybass: (v) => Runtime.setPsybassEnabled(s, v),
    subharm: (v) => Runtime.setSubharmEnabled(s, v),
    upmix: (v) => Runtime.setUpmixEnabled(s, v),
  };

  const active = $derived(resolveModule(noveauUi.programModule, s.device.capabilities.features));

  function openOutputInTune(): void {
    const snap = s.mirror.current;
    const sel = settings.selectedChannel;
    if (snap && !snap.outputs.some((o) => o.id === sel)) {
      const first = snap.outputs.find((o) => o.enabled) ?? snap.outputs[0];
      if (first) selectChannel(first.id);
    }
    noveauUi.destination = 'tune';
  }

  const lit = (b: ChainBlock) => b.enabled !== false;

  const STAGE: Record<string, 'inputs' | 'routing' | undefined> = {
    preamp: 'inputs', inputEq: 'inputs', leveller: 'inputs', upmix: 'inputs', matrix: 'routing',
  };
  const LABEL = { inputs: 'INPUTS', routing: 'ROUTING', outputs: 'PER OUTPUT' } as const;
  const groups = $derived.by(() => {
    const out: { id: keyof typeof LABEL; label: string; blocks: ChainBlock[] }[] = [];
    for (const b of blocks) {
      const id = STAGE[b.key] ?? 'outputs';
      const last = out[out.length - 1];
      if (last && last.id === id) last.blocks.push(b);
      else out.push({ id, label: LABEL[id], blocks: [b] });
    }
    return out;
  });
</script>

<div class="chain" role="group" aria-label="Processing chain">
  {#each groups as g, gi (g.id)}
    {#if gi > 0}<span class="cdiv"></span>{/if}
    <div class="grp g-{g.id}" style:flex="{g.blocks.length} 1 0">
      <span class="gl">{g.label}</span>
      <div class="row">
        {#each g.blocks as b, i (b.key)}
          {#if b.key === 'outputs' && i > 0}<span class="cdiv"></span>{:else if i > 0}<span class="wire" class:hot={lit(b)}></span>{/if}
          <div class="blk" class:anchor={b.kind === 'anchor'} class:on={b.kind === 'module' && lit(b)} class:offb={b.kind === 'module' && !lit(b)} class:sel={b.kind === 'module' && active === b.key}>
            {#if b.kind === 'module'}
              <button
                type="button"
                class="hit"
                aria-pressed={active === b.key}
                aria-label={`${b.title}: ${b.values.join(', ')}`}
                onclick={() => { noveauUi.programModule = b.key; }}
              ></button>
            {:else}
              <button type="button" class="jump-hit" aria-label="Open outputs in TUNE" onclick={openOutputInTune}></button>
            {/if}
            <div class="bh">
              <b>{b.title}</b>
              {#if b.kind === 'anchor'}
                <span class="go" aria-hidden="true">›</span>
              {:else if b.enabled !== null && SETTERS[b.key]}
                <span class="sw"><ToggleSwitch size="sm" checked={b.enabled} ariaLabel={`${b.title} enabled`} onChange={SETTERS[b.key]!} /></span>
              {/if}
            </div>
            <div class="bv" title={b.values.join(' · ')}>{b.values.join(' · ')}</div>
          </div>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .chain {
    display: flex;
    align-items: center;
    padding: 0 12px;
    min-width: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg) 85%, transparent);
  }
  .wire { flex: none; width: 6px; height: 2px; background: var(--border-hi); }
  .wire.hot { background: color-mix(in oklab, var(--accent) 60%, transparent); }
  .cdiv { flex: none; width: 1px; height: 44px; margin: 0 4px; background: var(--border-hi); }
  .grp {
    min-width: 0;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    background: color-mix(in oklab, var(--text) 3%, transparent);
  }
  .grp.g-routing { background: color-mix(in oklab, var(--accent) 5%, transparent); }
  .gl {
    flex: none;
    height: 14px;
    padding: 0 2px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 14px;
    letter-spacing: 0.04em;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
  }
  .row { display: flex; align-items: center; min-width: 0; }
  .blk {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    height: 52px;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--wash);
    box-shadow: 0 0 0 1px var(--border) inset;
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
  }
  .hit, .jump-hit {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    border-radius: inherit;
    background: none;
    cursor: pointer;
  }
  .bh {
    position: relative;
    z-index: 1;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    gap: 4px;
  }
  .bh b {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  .sw { pointer-events: auto; display: inline-flex; }
  .bv {
    position: relative;
    pointer-events: none;
    height: 16px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-feature-settings: 'tnum';
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .blk.on { background: color-mix(in oklab, var(--accent) 9%, var(--wash)); box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent) 22%, transparent) inset; }
  .blk.sel { box-shadow: 0 0 0 2px var(--accent) inset; background: color-mix(in oklab, var(--accent) 16%, transparent); }
  .blk.offb .bh b, .blk.offb .bv { color: var(--text-faint); }
  .blk.anchor { background: none; box-shadow: 0 0 0 1px var(--border) inset; }
  .go { flex: none; font-family: var(--font-sans); font-size: 14px; line-height: 1; color: var(--text-faint); }
  .blk:hover:not(.sel) { background: var(--wash-strong); }
  .hit:focus-visible, .jump-hit:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>

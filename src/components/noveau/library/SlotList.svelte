<script lang="ts">
  import { presetsDirty } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { PresetStartupMode } from '@/protocol';
  import { PRESET_SLOT_COUNT, type PresetSlot } from '@/domain';
  import { slotRows } from './slotRows';

  const { selected, onSelect }: { selected: PresetSlot | null; onSelect: (slot: PresetSlot) => void } = $props();
  const s = getSession();

  const slots = Array.from({ length: PRESET_SLOT_COUNT }, (_, i) => i as PresetSlot);
  const dir = $derived(s.presets.directory);
  const rows = $derived(slotRows({
    slots,
    names: s.presets.names,
    occupied: dir?.occupiedSlotsSet ?? null,
    active: s.presets.active,
    startup: dir != null && dir.startupMode === PresetStartupMode.Specified ? dir.defaultSlot : null,
    dirty: presetsDirty(s),
    copiedSlot: s.copySource.held?.slot ?? null,
  }));
</script>

<div class="slots">
  <div class="list" role="group" aria-label="Preset slots">
    {#each rows as r (r.slot)}
      <button
        type="button"
        class="row"
        class:sel={r.slot === selected}
        class:empty={!r.occupied && !r.active}
        aria-pressed={r.slot === selected}
        onclick={() => onSelect(r.slot)}
      >
        <span class="ix">{r.slot}</span>
        <span class="nm" class:unnamed={r.name.length === 0} class:dirty={r.dirty}>{r.name.length ? r.name : (r.occupied || r.active ? '[unnamed]' : 'empty')}</span>
        {#if r.copied}<span class="pill copied">COPIED</span>{/if}
        {#if r.startup}<span class="pill startup">STARTUP</span>{/if}
        {#if r.active}<span class="pill active">ACTIVE</span>{/if}
      </button>
    {/each}
  </div>
  <div class="legend">
    <span><i class="sw"></i>active</span>
    <span><i class="ul"></i>unsaved</span>
    <span><i class="sw st"></i>startup</span>
  </div>
</div>

<style>
  .slots { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
  .list { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius-m); overflow: hidden; }
  .row {
    height: 28px;
    flex: none;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-sans);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .row:last-child { border-bottom: none; }
  .row:hover:not(.sel) { background: var(--wash); color: var(--text); }
  .row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .row.sel { background: color-mix(in oklab, var(--accent) 14%, transparent); color: var(--text); }
  .ix { width: 14px; flex: none; font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); }
  .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .nm.unnamed { color: var(--text-dim); font-weight: 400; }
  .row.empty .nm { color: var(--text-faint); font-weight: 400; font-style: italic; }
  .nm.dirty { text-decoration: underline; text-decoration-color: var(--warn); text-decoration-thickness: 2px; text-underline-offset: 3px; }
  .pill {
    flex: none;
    height: 16px;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-s);
    border: 1px solid var(--border-hi);
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: var(--text-dim);
  }
  .pill.active { background: var(--accent); border-color: var(--accent); color: var(--bg); }
  .pill.startup { border-color: var(--warn); color: var(--warn); }
  .pill.copied { border-style: dashed; border-color: var(--accent); color: var(--accent); }
  .legend { display: flex; gap: 12px; font-size: 11px; color: var(--text-faint); }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend .sw { width: 10px; height: 10px; border-radius: 2px; background: var(--accent); }
  .legend .sw.st { background: none; border: 1px solid var(--warn); box-sizing: border-box; }
  .legend .ul { width: 10px; height: 2px; background: var(--warn); }
</style>

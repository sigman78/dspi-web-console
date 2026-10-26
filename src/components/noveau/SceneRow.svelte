<script lang="ts">
  import { presetsDirty } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { loadPresetSlot, revertActivePreset } from '@/runtime';
  import { saveActivePresetNamed } from '@/components/presets/saveActivePresetNamed';
  import PresetIcon from './presets/PresetIcon.svelte';
  import { noveauUi } from './noveauUi.svelte';
  import { PresetStartupMode } from '@/protocol';
  import { PRESET_SLOT_COUNT, type PresetSlot } from '@/domain';

  const s = getSession();

  const active = $derived(s.presets.active);
  const dir = $derived(s.presets.directory);
  const dirty = $derived(presetsDirty(s));
  const busy = $derived(s.presets.busy);
  const activeOccupied = $derived(active != null && (dir?.occupiedSlotsSet.has(active) ?? false));
  const canRevert = $derived(active != null && activeOccupied && dirty);
  const canSave = $derived(active != null && (dirty || !activeOccupied));
  const startup = $derived(
    dir != null && dir.startupMode === PresetStartupMode.Specified ? dir.defaultSlot : null,
  );
  const rawName = $derived(active == null ? '' : (s.presets.names[active] ?? ''));
  const name = $derived(active == null ? '—' : rawName.length ? rawName : '[unnamed]');

  const slots = Array.from({ length: PRESET_SLOT_COUNT }, (_, i) => i as PresetSlot);

  function onSlot(slot: PresetSlot): void {
    if (busy || slot === active) return;
    void loadPresetSlot(s, slot);
  }
  function onSave(): void {
    if (busy) return;
    void saveActivePresetNamed(s);
  }
  function onRevert(): void {
    if (busy) return;
    void revertActivePreset(s);
  }
</script>

<div class="scenes" role="group" aria-label="Presets">
  {#each slots as slot (slot)}
    {@const occupied = dir?.occupiedSlotsSet.has(slot) ?? false}
    <button
      type="button"
      class="sc"
      class:act={slot === active}
      class:empty={!occupied && slot !== active}
      aria-pressed={slot === active}
      class:startup={slot === startup}
      class:unsaved={slot === active && dirty}
      title={`${slot} ${s.presets.names[slot] || `Preset ${slot}`}${slot === startup ? ' (startup)' : ''}${slot === active && dirty ? ' · unsaved changes' : ''}`}
      aria-label={`${slot}${s.presets.names[slot] ? ' ' + s.presets.names[slot] : ''}${slot === startup ? ' (startup)' : ''}${slot === active && dirty ? ' · unsaved changes' : ''}`}
      onclick={() => onSlot(slot)}
    >
      {slot}
    </button>
  {/each}
</div>
<div class="sname">
  <button
    type="button"
    class="field"
    class:open={noveauUi.presetsOpen}
    data-presets-toggle
    aria-label="Manage presets"
    aria-expanded={noveauUi.presetsOpen}
    aria-haspopup="dialog"
    onclick={() => { noveauUi.presetsOpen = !noveauUi.presetsOpen; }}
  >
    <span class="nm" class:unnamed={rawName.length === 0}>{name}</span>
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4l4 4 4-4" /></svg>
  </button>
  {#if canSave}<button type="button" class="icon-toggle accent" aria-label="Save preset" title="Save preset" onclick={onSave}><PresetIcon icon="save" /></button>{/if}
  {#if canRevert}<button type="button" class="icon-toggle" aria-label="Revert preset" title="Revert preset" onclick={onRevert}><PresetIcon icon="revert" /></button>{/if}
</div>

<style>
  .scenes { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; height: 22px; }
  .sc {
    position: relative;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    background: var(--wash-strong);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .sc:hover:not(.act) { color: var(--text); border-color: var(--border-hi); }
  .sc.empty {
    background: none;
    border: 1px dashed var(--border-hi);
    color: var(--text-faint);
  }
  .sc.act {
    background: var(--accent);
    color: var(--bg);
    font-weight: 700;
    cursor: default;
  }
  .sc.startup:hover { border-color: var(--warn); }
  .sc.startup {
    border: 1px solid var(--warn);
    box-shadow: 0 0 6px color-mix(in oklab, var(--warn) 55%, transparent);
  }
  .sc.unsaved::after {
    content: '';
    position: absolute;
    left: 3px; right: 3px; bottom: 1px;
    height: 2px;
    border-radius: 1px;
    background: var(--warn);
  }
  .sname {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    font-size: 12px;
    font-weight: 600;
  }
  .field {
    flex: 1;
    min-width: 0;
    height: 22px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    background: var(--wash-faint);
    color: var(--text-dim);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .field:hover { border-color: var(--border-hi); color: var(--text); }
  .field.open { border-color: var(--accent); }
  .field svg { flex: none; margin-left: auto; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .field.open svg { transform: rotate(180deg); }
  .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nm.unnamed { color: var(--text-dim); }
  .sname .icon-toggle { flex: none; width: 20px; height: 20px; }
  .sname .icon-toggle.accent { color: var(--accent); }
</style>

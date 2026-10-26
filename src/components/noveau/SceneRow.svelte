<script lang="ts">
  import { presetsDirty } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { loadPresetSlot, revertActivePreset } from '@/runtime';
  import { saveActivePresetNamed } from '@/components/presets/saveActivePresetNamed';
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
  const name = $derived.by(() => {
    if (active == null) return '—';
    const n = s.presets.names[active] ?? '';
    return n.length ? n : '[unnamed]';
  });

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
      title={s.presets.names[slot] || `Preset ${slot}`}
      onclick={() => onSlot(slot)}
    >
      {String(slot).padStart(2, '0')}
      {#if slot === startup}<span class="st" aria-label="startup slot">★</span>{/if}
      {#if slot === active && dirty}<span class="dd" aria-label="unsaved changes"></span>{/if}
    </button>
  {/each}
</div>
<div class="sname">
  <span class="nm" title={name}>{name}</span>
  {#if canSave}<button type="button" class="chip accent" onclick={onSave}>Save</button>{/if}
  {#if canRevert}<button type="button" class="chip hi" onclick={onRevert}>Revert</button>{/if}
</div>

<style>
  .scenes { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; height: 20px; }
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
    font-size: 10px;
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
  .st {
    position: absolute;
    top: 0; right: 1px;
    font-size: 10px;
    line-height: 1;
    color: var(--warn);
  }
  .sc.act .st { color: var(--bg); }
  .dd {
    position: absolute;
    bottom: 1px; right: 1px;
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--warn);
    box-shadow: 0 0 0 1px var(--bg);
  }
  .sname {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    font-size: 12px;
    font-weight: 600;
  }
  .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sname .chip { flex: none; height: 20px; padding: 0 8px; font-size: 11px; letter-spacing: 0; font-family: var(--font-sans); font-weight: 600; }
</style>

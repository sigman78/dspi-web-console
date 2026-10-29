<script lang="ts">
  import { boundary, presetsDirty } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { loadPresetSlot } from '@/runtime';
  import { PresetStartupMode } from '@/protocol';
  import { PRESET_SLOT_COUNT, type PresetSlot } from '@/domain';

  const s = getSession();

  const active = $derived(s.presets.active);
  const dir = $derived(s.presets.directory);
  const dirty = $derived(presetsDirty(s));
  const startup = $derived(
    dir != null && dir.startupMode === PresetStartupMode.Specified ? dir.defaultSlot : null,
  );
  const slots = Array.from({ length: PRESET_SLOT_COUNT }, (_, i) => i as PresetSlot);

  function onSlot(slot: PresetSlot): void {
    if (s.presets.busy || slot === active) return;
    void loadPresetSlot(s, slot);
  }
</script>

<div class="strip" role="group" aria-label="Presets">
  {#each slots as slot (slot)}
    {@const occupied = dir?.occupiedSlotsSet.has(slot) ?? false}
    {@const raw = s.presets.names[slot] ?? ''}
    {@const empty = !occupied && slot !== active}
    <button
      type="button"
      class="slot"
      class:act={slot === active}
      class:empty
      class:startup={slot === startup}
      class:unsaved={slot === active && dirty}
      aria-pressed={slot === active}
      aria-label={`${slot}${raw ? ' ' + raw : ''}${slot === startup ? ' (startup)' : ''}${slot === active && dirty ? ' · unsaved changes' : ''}`}
      disabled={boundary.pending != null}
      onclick={() => onSlot(slot)}
    >
      <span class="num">{slot}</span>
      <span class="nm">{empty ? 'empty' : raw.length ? raw : '[unnamed]'}</span>
    </button>
  {/each}
</div>

<style>
  .strip {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 6px;
    height: 72px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--surface-chrome);
  }
  .slot {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-m);
    background: var(--wash);
    color: var(--text-dim);
    text-align: left;
    cursor: pointer;
  }
  .num {
    flex: none;
    font-family: var(--font-mono);
    font-size: 28px;
    font-weight: 500;
    line-height: 1;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-l);
    font-weight: 500;
  }
  .slot:hover:not(.act) { color: var(--text); border-color: var(--accent); }
  .slot.empty { background: none; border-style: dashed; color: var(--text-faint); }
  .slot.empty .nm { font-style: italic; }
  .slot.act {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    cursor: default;
  }
  .slot.act .nm { font-weight: 700; }
  .slot:disabled:not(.act) { opacity: var(--dim-disabled); cursor: default; }
  .slot.startup::before {
    content: '';
    position: absolute;
    top: 0; right: 0;
    border-style: solid;
    border-width: 0 14px 14px 0;
    border-color: transparent var(--text-dim) transparent transparent;
    border-top-right-radius: var(--radius-m);
  }
  .slot.startup.empty::before { border-right-color: var(--text-faint); }
  .slot.startup.act::before { border-right-color: color-mix(in oklab, var(--bg) 70%, white); }
  .slot.act.unsaved { animation: slot-pulse 2.4s ease-in-out infinite alternate; }
  @keyframes slot-pulse {
    from { background: var(--accent); }
    to { background: color-mix(in oklab, var(--accent) 70%, white); }
  }
  @media (prefers-reduced-motion: reduce) {
    .slot.act.unsaved { animation: none; background: color-mix(in oklab, var(--accent) 70%, white); }
  }
</style>

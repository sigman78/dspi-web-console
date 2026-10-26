<script lang="ts">
  import { tick } from 'svelte';
  import { presetsDirty } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { loadPresetSlot, renamePresetSlot, revertActivePreset } from '@/runtime';
  import { saveActivePresetNamed } from '@/components/presets/saveActivePresetNamed';
  import { PresetStartupMode } from '@/protocol';
  import { PRESET_NAME_MAX_LEN, PRESET_SLOT_COUNT, type PresetSlot } from '@/domain';

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
  let editing = $state(false);
  let editSlot: PresetSlot | null = null;
  let editBase = '';
  let nameEl = $state<HTMLSpanElement>();
  // Each edit session ends with exactly one terminal action; Enter and Escape
  // unmount the input, whose trailing blur would otherwise fire a second one.
  let finished = false;

  function startEdit(): void {
    if (busy || active == null) return;
    window.getSelection()?.removeAllRanges();
    editSlot = active;
    editBase = rawName;
    editing = true;
  }
  function initInput(node: HTMLInputElement): void {
    finished = false;
    node.value = editBase;
    node.focus();
    node.select();
  }
  function finishEdit(node: HTMLInputElement, commit: boolean): void {
    if (finished) return;
    finished = true;
    editing = false;
    const next = node.value.trim();
    if (commit && editSlot != null && next.length > 0 && next !== editBase) void renamePresetSlot(s, editSlot, next);
  }
  function refocusName(): void {
    void tick().then(() => nameEl?.focus());
  }
  function onInputKey(e: KeyboardEvent): void {
    const node = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      finishEdit(node, true);
      refocusName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finishEdit(node, false);
      refocusName();
    }
  }
  function onNameKey(e: KeyboardEvent): void {
    if (e.key === 'F2' || e.key === 'Enter') {
      e.preventDefault();
      startEdit();
    }
  }
  $effect(() => {
    if (editing && active !== editSlot) {
      finished = true;
      editing = false;
    }
  });
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
      title={`${slot} ${s.presets.names[slot] || `Preset ${slot}`}${slot === startup ? ' (startup)' : ''}`}
      aria-label={`${slot}${s.presets.names[slot] ? ' ' + s.presets.names[slot] : ''}${slot === startup ? ' (startup)' : ''}`}
      onclick={() => onSlot(slot)}
    >
      {slot}
      {#if slot === active && dirty}<span class="dd" aria-label="unsaved changes"></span>{/if}
    </button>
  {/each}
</div>
<div class="sname">
  {#if editing}
    <input
      class="nm-edit"
      type="text"
      maxlength={PRESET_NAME_MAX_LEN}
      aria-label="Preset name"
      use:initInput
      onkeydown={onInputKey}
      onblur={(e) => finishEdit(e.currentTarget, true)}
    />
  {:else}
    <span
      class="nm"
      class:unnamed={rawName.length === 0}
      role="button"
      tabindex="0"
      bind:this={nameEl}
      aria-keyshortcuts="F2"
      title="Double-click or F2 to rename"
      ondblclick={startEdit}
      onkeydown={onNameKey}
    >{name}</span>
    {#if canSave}<button type="button" class="chip accent" onclick={onSave}>Save</button>{/if}
    {#if canRevert}<button type="button" class="chip hi" onclick={onRevert}>Revert</button>{/if}
  {/if}
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
  .dd {
    position: absolute;
    top: 1px; right: 1px;
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
  .nm.unnamed { color: var(--text-dim); }
  .nm-edit {
    flex: 1;
    min-width: 0;
    height: 22px;
    padding: 0 4px;
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 3px;
  }
  .nm { cursor: default; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sname .chip { flex: none; height: 20px; padding: 0 8px; font-size: 11px; letter-spacing: 0; font-family: var(--font-sans); font-weight: 600; }
</style>

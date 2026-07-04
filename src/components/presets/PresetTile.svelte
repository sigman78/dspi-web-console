<script lang="ts">
  import { presetsDirty } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { loadPresetSlot, renamePresetSlot } from '@/runtime';
  import { PresetStartupMode } from '@/protocol';
  import { type PresetSlot, PRESET_NAME_MAX_LEN } from '@/domain';

  const { slot }: { slot: PresetSlot } = $props();
  const s = getSession();

  const occupied = $derived(s.presets.directory?.occupiedSlotsSet.has(slot) ?? false);
  const isActive = $derived(s.presets.active === slot);
  const isStartup = $derived.by(() => {
    const d = s.presets.directory;
    return d != null && d.startupMode === PresetStartupMode.Specified && d.defaultSlot === slot;
  });
  const isCopySource = $derived(s.copySource.held?.slot === slot);
  const isDirty = $derived(isActive && presetsDirty(s));
  const name = $derived(s.presets.names[slot] ?? '');

  let editing = $state(false);
  let editValue = $state('');
  let renameInput: HTMLTextAreaElement | null = $state(null);

  export function enterRename(): void {
    // Slot names live in the directory and persist independently of
    // occupancy or active state, so any tile can be renamed.
    editValue = name;
    editing = true;
    setTimeout(() => renameInput?.focus(), 0);
  }

  function onDoubleClick(e: MouseEvent) {
    if (editing) return;
    e.preventDefault();
    enterRename();
  }

  async function commitRename() {
    if (!editing) return;
    editing = false;
    const trimmed = editValue.trim();
    if (trimmed.length > 0 && trimmed !== name) {
      await renamePresetSlot(s, slot, trimmed);
    }
  }
  function cancelRename() {
    editing = false;
    editValue = '';
  }
  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  async function onClick() {
    if (editing) return;
    if (isActive) return;
    await loadPresetSlot(s, slot);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (editing) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void onClick();
    } else if (e.key === 'F2') {
      e.preventDefault();
      enterRename();
    }
  }
</script>

<div
  class="tile"
  class:empty={!occupied}
  class:active={isActive}
  class:dirty={isDirty}
  class:copy-source={isCopySource}
  class:renaming={editing}
  onclick={onClick}
  ondblclick={onDoubleClick}
  onkeydown={onKeyDown}
  role="button"
  tabindex="0"
>
  {#if isStartup}<span class="star-top" aria-label="startup slot">★</span>{/if}

  {#if editing}
    <textarea
      class="rename-input"
      bind:this={renameInput}
      bind:value={editValue}
      onkeydown={onInputKey}
      onblur={commitRename}
      maxlength={PRESET_NAME_MAX_LEN}
      rows="3"
    ></textarea>
  {:else}
    <span class="tname">{name.length ? name : (occupied ? '[unnamed]' : 'Empty')}</span>
  {/if}

  {#if isDirty}<span class="dirty-dot" aria-label="unsaved changes"></span>{/if}
  <span class="wm" aria-hidden="true">{String(slot).padStart(2, '0')}</span>
</div>

<style>
  .tile {
    aspect-ratio: 1.15 / 1;
    background: var(--panel-hi);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    position: relative;
    cursor: pointer;
    padding: 10px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
    font-family: var(--font-mono);
    transition: border-color 120ms, background 120ms;
  }
  .tile:hover:not(.active) { border-color: var(--border-hi); }
  .tile.empty {
    background: color-mix(in oklab, var(--panel-hi) 70%, transparent);
  }
  .tile.active {
    border-color: var(--accent);
    background: linear-gradient(180deg,
      color-mix(in oklab, var(--accent) 12%, var(--panel-hi)),
      color-mix(in oklab, var(--accent) 6%, var(--panel-hi)));
    cursor: default;
  }
  .tile.copy-source {
    border-style: dashed;
    border-color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent) inset;
  }

  .star-top {
    position: absolute; top: 8px; right: 10px;
    font-size: 14px; color: var(--warn); line-height: 1;
    pointer-events: none; z-index: 2;
  }
  .dirty-dot {
    position: absolute; bottom: 8px; right: 8px;
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px color-mix(in oklab, var(--accent) 70%, transparent);
    z-index: 2;
  }
  .wm {
    position: absolute; bottom: -8px; right: -2px;
    font-size: 52px;
    color: var(--wash);
    font-weight: 800; line-height: 1; letter-spacing: -2px;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .tile.active .wm { color: color-mix(in oklab, var(--accent) 22%, transparent); }
  .tile.copy-source .wm { color: color-mix(in oklab, var(--accent) 18%, transparent); }

  .tname {
    font-size: 13px;
    color: var(--text);
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: 0.3px;
    position: relative;
    z-index: 1;
    word-break: break-word;
  }
  .tile.empty .tname {
    color: var(--text-faint);
    font-weight: 500;
    font-style: italic;
  }

  /* Full-tile rename overlay */
  .tile.renaming { padding: 0; cursor: text; }
  .rename-input {
    position: absolute; inset: 0;
    width: 100%; height: 100%; box-sizing: border-box;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--accent);
    border-radius: var(--radius-m);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    padding: 10px;
    resize: none;
    outline: none;
    line-height: 1.2;
    z-index: 4;
  }
  .rename-input:focus {
    box-shadow: 0 0 0 1px var(--accent) inset;
  }
</style>

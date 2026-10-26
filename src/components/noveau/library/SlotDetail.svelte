<script lang="ts">
  import { presetsDirty, settings } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import { saveActivePresetNamed } from '@/components/presets/saveActivePresetNamed';
  import {
    loadPresetSlot, revertActivePreset, deletePresetSlot, renamePresetSlot,
    copyActivePreset, pastePresetTo, setStartupDefault, setStartupMode,
    setMasterVolumeMode, setOutputConfigMode, dismissPresetActionError,
    exportHeldPreset, decodeImportedPreset,
  } from '@/runtime';
  import { PresetStartupMode } from '@/protocol';
  import type { DeviceState } from '@/protocol/snapshotCodec';
  import {
    MasterVolumeMode, OutputConfigMode, PRESET_NAME_MAX_LEN,
    type PresetSlot,
  } from '@/domain';

  const { slot }: { slot: PresetSlot } = $props();
  const s = getSession();

  const active = $derived(s.presets.active);
  const dir = $derived(s.presets.directory);
  const dirty = $derived(presetsDirty(s));
  const isActive = $derived(slot === active);
  const occupied = $derived(dir?.occupiedSlotsSet.has(slot) ?? false);
  const activeOccupied = $derived(active != null && (dir?.occupiedSlotsSet.has(active) ?? false));
  const held = $derived(s.copySource.held);
  const rawName = $derived(s.presets.names[slot] ?? '');
  const startupMode = $derived(dir?.startupMode ?? PresetStartupMode.Specified);
  const isStartup = $derived(dir != null && startupMode === PresetStartupMode.Specified && dir.defaultSlot === slot);
  const mvMode = $derived(dir?.masterVolumeMode ?? MasterVolumeMode.Independent);
  const ocMode = $derived(dir?.outputConfigMode ?? OutputConfigMode.Independent);

  const canLoad = $derived(!isActive);
  const canSave = $derived(isActive && (dirty || !activeOccupied));
  const canRevert = $derived(isActive && activeOccupied && dirty);
  const canDelete = $derived(!isActive && occupied);
  const canCopy = $derived(isActive && activeOccupied && !dirty && held == null);
  const canPaste = $derived(held != null && held.slot !== slot);

  const caption = $derived([
    isActive ? 'active' : occupied ? 'saved' : 'empty',
    isActive && dirty ? 'unsaved changes' : null,
    isStartup ? 'startup' : null,
  ].filter((p) => p != null).join(' · '));

  let localError = $state<string | null>(null);
  const errorText = $derived(localError ?? s.presets.lastActionError);

  function dismissError(): void {
    localError = null;
    dismissPresetActionError(s);
  }

  // Slot-level verbs act on the active slot, so a paste into another slot
  // first activates it through the normal LOAD path (dirty prompt included).
  async function pasteInto(target: PresetSlot, state: DeviceState): Promise<boolean> {
    if (s.presets.busy) return false;
    if (target !== s.presets.active) {
      await loadPresetSlot(s, target);
      if (s.presets.active !== target) return false;
    }
    const r = await pastePresetTo(s, state);
    return r.ok;
  }

  async function onLoad() { if (!s.presets.busy) await loadPresetSlot(s, slot); }
  async function onSave() { await saveActivePresetNamed(s); }
  async function onRevert() { if (!s.presets.busy) await revertActivePreset(s); }
  async function onDelete() { if (!s.presets.busy) await deletePresetSlot(s, slot); }
  async function onCopy() { if (!s.presets.busy) await copyActivePreset(s); }
  function onDrop() { if (!s.presets.busy) s.copySource.held = null; }
  async function onPaste() { if (held != null) await pasteInto(slot, held.blob); }

  async function onSetStartup() {
    if (s.presets.busy) return;
    if (startupMode !== PresetStartupMode.Specified) await setStartupMode(s, PresetStartupMode.Specified);
    await setStartupDefault(s, slot);
  }

  function onExport(): void {
    const out = exportHeldPreset(s);
    if (out == null) return;
    localError = null;
    const url = URL.createObjectURL(new Blob([out.text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = out.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  let fileEl: HTMLInputElement | undefined = $state();
  async function onFile(e: Event): Promise<void> {
    const target = slot;
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    localError = null;
    dismissPresetActionError(s);
    const decoded = decodeImportedPreset(s, await file.text());
    if (!decoded.ok) { localError = decoded.reason; return; }
    const pasted = await pasteInto(target, decoded.state);
    const name = decoded.name.trim();
    if (pasted && name.length > 0 && name !== (s.presets.names[target] ?? '')) {
      await renamePresetSlot(s, target, name);
    }
  }

  let editing = $state(false);
  let editSlot: PresetSlot | null = null;
  let editBase = '';
  let nameEl = $state<HTMLSpanElement>();
  let finished = false;

  function startEdit(): void {
    if (s.presets.busy) return;
    window.getSelection()?.removeAllRanges();
    editSlot = slot;
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
    void Promise.resolve().then(() => nameEl?.focus());
  }
  function onInputKey(e: KeyboardEvent): void {
    const node = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finishEdit(node, e.key === 'Enter');
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
    if (editing && slot !== editSlot) {
      finished = true;
      editing = false;
    }
  });
</script>

<div class="detail">
  <div class="namerow">
    <span class="ix">{slot}</span>
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
      >{rawName.length ? rawName : occupied || isActive ? '[unnamed]' : 'empty'}</span>
    {/if}
  </div>
  <div class="caption">{caption}</div>

  <div class="grp">
    <h4>SLOT</h4>
    <div class="btns">
      <button type="button" class="chip" onclick={onLoad} disabled={!canLoad}>LOAD</button>
      <button type="button" class="chip accent" onclick={onSave} disabled={!canSave}>SAVE</button>
      <button type="button" class="chip" onclick={onRevert} disabled={!canRevert}>REVERT</button>
      <ConfirmButton label="DELETE" confirmLabel="CONFIRM" tone="danger" onConfirm={onDelete} disabled={!canDelete} title="Erase this slot from the device" />
    </div>
  </div>

  <div class="grp">
    <h4>CLIPBOARD</h4>
    <div class="btns">
      {#if held != null}
        <button type="button" class="chip accent" onclick={onDrop} title={`Drop the copied preset "${held.name}"`}>DROP</button>
      {:else}
        <button type="button" class="chip" onclick={onCopy} disabled={!canCopy} title={isActive && dirty ? 'Save changes to copy this state' : ''}>COPY</button>
      {/if}
      <button
        type="button"
        class="chip"
        class:accent={canPaste}
        onclick={onPaste}
        disabled={!canPaste}
        title={held != null ? `Paste "${held.name}" into this slot` : ''}
      >PASTE</button>
    </div>
  </div>

  <div class="grp">
    <h4>STARTUP</h4>
    <div class="btns">
      <button type="button" class="chip" onclick={onSetStartup} disabled={isStartup || !(occupied || isActive)}>SET AS STARTUP</button>
    </div>
  </div>

  <div class="grp">
    <h4>TRANSFER</h4>
    <div class="btns">
      <button type="button" class="chip" onclick={onExport} disabled={held == null} title={held == null ? 'Copy a preset first' : `Export "${held.name}" as a file`}>EXPORT</button>
      <button type="button" class="chip" onclick={() => fileEl?.click()} title="Import a preset file into this slot">IMPORT</button>
    </div>
    <input bind:this={fileEl} type="file" accept=".json,application/json" hidden onchange={onFile} />
  </div>

  <div class="grp" role="group" aria-label="Device-wide preset options">
    <h4>DEVICE-WIDE</h4>
    <div class="trow">
      <span>Boot into last active preset</span>
      <ToggleSwitch size="sm" ariaLabel="Boot into last active preset" disabled={dir == null}
        checked={startupMode === PresetStartupMode.LastActive}
        onChange={(v) => void setStartupMode(s, v ? PresetStartupMode.LastActive : PresetStartupMode.Specified)} />
    </div>
    <div class="trow">
      <span>Master volume stored with preset</span>
      <ToggleSwitch size="sm" ariaLabel="Include master volume in preset" disabled={dir == null}
        checked={mvMode === MasterVolumeMode.WithPreset}
        onChange={(v) => void setMasterVolumeMode(s, v ? MasterVolumeMode.WithPreset : MasterVolumeMode.Independent)} />
    </div>
    <div class="trow">
      <span>Output config stored with preset</span>
      <ToggleSwitch size="sm" ariaLabel="Include IO configuration in preset" disabled={dir == null}
        checked={ocMode === OutputConfigMode.WithPreset}
        onChange={(v) => void setOutputConfigMode(s, v ? OutputConfigMode.WithPreset : OutputConfigMode.Independent)} />
    </div>
    <div class="trow">
      <span>Warn when switching with unsaved changes</span>
      <ToggleSwitch size="sm" ariaLabel="Warn on preset switch when changes are unsaved"
        checked={settings.warnOnPresetSwitchDirty}
        onChange={(v) => { settings.warnOnPresetSwitchDirty = v; }} />
    </div>
  </div>

  {#if errorText}
    <div class="err" role="alert">
      <span>{errorText}</span>
      <button type="button" onclick={dismissError} aria-label="Dismiss">×</button>
    </div>
  {/if}
</div>

<style>
  .detail { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; overflow: hidden; }
  .namerow { display: flex; align-items: center; gap: 8px; height: 24px; }
  .ix { font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); }
  .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; cursor: default; }
  .nm.unnamed { color: var(--text-dim); font-weight: 400; }
  .nm-edit {
    flex: 1; min-width: 0; height: 24px; box-sizing: border-box; padding: 0 4px;
    font: inherit; font-size: 12px; color: var(--text); background: var(--bg);
    border: 1px solid var(--accent); border-radius: var(--radius-s);
  }
  .caption { font-size: 11px; color: var(--text-dim); margin-top: -4px; }
  .grp { display: flex; flex-direction: column; gap: 4px; }
  h4 { margin: 0; height: 16px; font-family: var(--font-sans); font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: var(--text-faint); }
  .btns { display: flex; flex-wrap: nowrap; gap: 8px; }
  .btns :global(.chip) {
    height: 24px; box-sizing: border-box; padding: 0 6px;
    font-family: var(--font-sans); font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
  }
  .trow { display: flex; align-items: center; gap: 8px; height: 24px; font-size: 11px; color: var(--text-dim); }
  .trow span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trow :global(.sw) { padding: 0; }
  .err {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    min-height: 24px; box-sizing: border-box; padding: 2px 8px;
    background: color-mix(in oklab, var(--err) 14%, transparent);
    border: 1px solid color-mix(in oklab, var(--err) 45%, var(--border));
    border-radius: var(--radius-s);
    font-size: 11px; color: var(--err);
  }
  .err button { background: none; border: none; color: var(--err); cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
</style>

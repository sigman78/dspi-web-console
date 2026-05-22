<!-- src/components/presets/PresetControls.svelte -->
<script lang="ts">
  import {
    presets, presetsDirty,
    copySource, setCopySource, clearCopySource,
    settings, session,
  } from '@/state';
  import {
    saveActivePreset, revertActivePreset,
    setStartupDefault, setStartupMode, pastePresetTo, renamePresetSlot,
    setMasterVolumeMode, setPresetIncludePins,
  } from '@/runtime';
  import { MasterVolumeMode } from '@/domain';
  import { PresetStartupMode } from '@/protocol';

  const { onRequestRename }: { onRequestRename: () => void } = $props();

  const active = $derived(presets.active);
  const dir = $derived(presets.directory);
  const dirty = $derived(presetsDirty.current);
  const connected = $derived(session.status === 'connected');
  const activeOccupied = $derived.by(() => {
    if (active == null || !dir) return false;
    return dir.occupiedSlotsSet.has(active);
  });

  // Action button enable/disable — visual predicates only.
  // The busy guard lives in the handlers below (silent no-op on click
  // while a wire op is in flight) so the buttons don't visibly flicker
  // disabled→enabled during fast wire ops like a preset switch.
  const canSave = $derived(active != null && (dirty || !activeOccupied));
  const canRevert = $derived(active != null && activeOccupied && dirty);
  const canRename = $derived(active != null);
  const canCopy = $derived(active != null && activeOccupied && !dirty && copySource.slot == null);
  const isCopyHeld = $derived(copySource.slot != null);
  const canPaste = $derived(copySource.slot != null && active != null && copySource.slot !== active);
  const canSetStartup = $derived(active != null);

  // Settings group state
  const startupMode = $derived(dir?.startupMode ?? PresetStartupMode.Specified);
  const mvMode = $derived(dir?.masterVolumeMode ?? MasterVolumeMode.Independent);
  const includePins = $derived(dir?.includePins ?? false);

  async function onSave() {
    if (presets.busy || active == null) return;
    if (!activeOccupied) {
      const fallback = `Preset ${active + 1}`;
      const currentName = presets.names[active] ?? '';
      if (currentName.length === 0) {
        await renamePresetSlot(active, fallback);
      }
    }
    await saveActivePreset();
  }

  async function onRevert() {
    if (presets.busy) return;
    await revertActivePreset();
  }

  function onCopy() {
    if (presets.busy || active == null) return;
    setCopySource(active);
  }
  function onDrop() {
    if (presets.busy) return;
    clearCopySource();
  }

  async function onPaste() {
    if (presets.busy) return;
    const src = copySource.slot;
    if (src == null) return;
    const r = await pastePresetTo(src);
    if ('ok' in r && r.ok) clearCopySource();
  }

  async function onSetStartup() {
    if (presets.busy || active == null) return;
    if (startupMode !== PresetStartupMode.Specified) {
      await setStartupMode(PresetStartupMode.Specified);
    }
    await setStartupDefault(active);
  }

  async function onStartupModeChange(e: Event) {
    const v = (e.target as HTMLInputElement).value === 'last'
      ? PresetStartupMode.LastActive
      : PresetStartupMode.Specified;
    await setStartupMode(v);
  }

  async function onIncludePinsChange(e: Event) {
    const v = (e.target as HTMLInputElement).checked;
    await setPresetIncludePins(v);
  }

  function onWarnToggleChange(e: Event) {
    settings.warnOnPresetSwitchDirty = (e.target as HTMLInputElement).checked;
  }
</script>

<div class="ctrl" class:disabled={!connected || dir == null}>
  <div class="group">
    <h4>ACTIONS</h4>
    <button class="btn primary" onclick={onSave} disabled={!canSave}>SAVE</button>
    <div class="row2">
      <button class="btn" onclick={onRequestRename} disabled={!canRename}>RENAME</button>
      <button class="btn" onclick={onRevert} disabled={!canRevert}>REVERT</button>
    </div>
    <div class="row2">
      {#if isCopyHeld}
        <button class="btn warn" onclick={onDrop}>DROP</button>
      {:else}
        <button
          class="btn"
          onclick={onCopy}
          disabled={!canCopy}
          title={canCopy ? '' : (dirty ? 'Save changes to copy this state' : '')}
        >COPY</button>
      {/if}
      <button class="btn" class:primary={canPaste} onclick={onPaste} disabled={!canPaste}>PASTE</button>
    </div>
    <div class="row2">
      <button class="btn" disabled title="Not yet implemented">IMPORT</button>
      <button class="btn" disabled title="Not yet implemented">EXPORT</button>
    </div>
    <button class="btn" onclick={onSetStartup} disabled={!canSetStartup}>SET AS STARTUP</button>
  </div>

  <div class="divider"></div>

  <fieldset class="group" disabled={!connected || dir == null}>
    <h4>INCLUDES IN PRESET</h4>
    <label class="toggle">
      <input
        type="checkbox"
        checked={mvMode === MasterVolumeMode.WithPreset}
        onchange={(e) => {
          const target = e.target as HTMLInputElement;
          void setMasterVolumeMode(target.checked ? MasterVolumeMode.WithPreset : MasterVolumeMode.Independent);
        }}
      />
      <span>Master volume</span>
    </label>
    <label class="toggle">
      <input type="checkbox" checked={includePins} onchange={onIncludePinsChange} />
      <span>Pin assignments</span>
    </label>
  </fieldset>

  <div class="divider"></div>

  <fieldset class="group" disabled={!connected || dir == null}>
    <h4>STARTUP MODE</h4>
    <label class="toggle">
      <input
        type="radio"
        name="startup"
        value="specified"
        checked={startupMode === PresetStartupMode.Specified}
        onchange={onStartupModeChange}
      />
      <span>Specified slot</span>
    </label>
    <label class="toggle">
      <input
        type="radio"
        name="startup"
        value="last"
        checked={startupMode === PresetStartupMode.LastActive}
        onchange={onStartupModeChange}
      />
      <span>Last active</span>
    </label>
  </fieldset>

  <div class="divider"></div>

  <div class="group">
    <h4>OPTIONS</h4>
    <label class="toggle">
      <input
        type="checkbox"
        checked={settings.warnOnPresetSwitchDirty}
        onchange={onWarnToggleChange}
      />
      <span>Warn on preset switch when changes are unsaved</span>
    </label>
  </div>
</div>

<style>
  .ctrl {
    display: flex; flex-direction: column; gap: 14px;
    padding: 12px 14px;
  }
  .group { display: flex; flex-direction: column; gap: 6px; border: none; padding: 0; margin: 0; }
  .group h4 {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 1.5px;
    color: var(--text-faint);
    margin: 0 0 4px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .btn {
    text-align: center;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--panel-solid);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 1.5px;
    font-weight: 700;
    cursor: pointer;
    text-transform: uppercase;
  }
  .btn:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn.primary {
    color: var(--accent);
    border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
    background: color-mix(in oklab, var(--accent) 12%, transparent);
  }
  .btn.warn {
    color: var(--accent);
    border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
    background: color-mix(in oklab, var(--accent) 8%, transparent);
  }
  .toggle {
    display: flex; align-items: center; gap: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
    padding: 3px 0;
    cursor: pointer;
    line-height: 1.4;
  }
  .toggle input[type="checkbox"], .toggle input[type="radio"] {
    accent-color: var(--accent);
    width: 11px; height: 11px;
    flex: 0 0 auto;
  }
  .divider {
    height: 1px;
    background: var(--border);
  }
</style>

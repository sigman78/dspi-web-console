<script lang="ts">
  import {
    presetsDirty,
    settings, connection,
  } from '@/state';
  import {
    saveActivePreset, revertActivePreset,
    setStartupDefault, setStartupMode, pastePresetTo, renamePresetSlot,
    setMasterVolumeMode, setOutputConfigMode,
  } from '@/runtime';
  import { MasterVolumeMode, OutputConfigMode } from '@/domain';
  import { PresetStartupMode } from '@/protocol';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { getSession } from '@/components/sessionContext';

  const { onRequestRename }: { onRequestRename: () => void } = $props();
  const s = getSession();

  const active = $derived(s.presets.active);
  const dir = $derived(s.presets.directory);
  const dirty = $derived(presetsDirty(s));
  const connected = $derived(connection.connected);
  const activeOccupied = $derived.by(() => {
    if (active == null || !dir) return false;
    return dir.occupiedSlotsSet.has(active);
  });

  // Action button enable/disable -- visual predicates only.
  // The busy guard lives in the handlers below (silent no-op on click
  // while a wire op is in flight) so the buttons don't visibly flicker
  // disabled->enabled during fast wire ops like a preset switch.
  const canSave = $derived(active != null && (dirty || !activeOccupied));
  const canRevert = $derived(active != null && activeOccupied && dirty);
  const canRename = $derived(active != null);
  const canCopy = $derived(active != null && activeOccupied && !dirty && s.copySource.slot == null);
  const isCopyHeld = $derived(s.copySource.slot != null);
  const canPaste = $derived(s.copySource.slot != null && active != null && s.copySource.slot !== active);
  const canSetStartup = $derived(active != null);

  const startupMode = $derived(dir?.startupMode ?? PresetStartupMode.Specified);
  const mvMode = $derived(dir?.masterVolumeMode ?? MasterVolumeMode.Independent);
  const ocMode = $derived(dir?.outputConfigMode ?? OutputConfigMode.Independent);

  async function onSave() {
    if (s.presets.busy || active == null) return;
    if (!activeOccupied) {
      const fallback = `Preset ${active + 1}`;
      const currentName = s.presets.names[active] ?? '';
      if (currentName.length === 0) {
        await renamePresetSlot(s, active, fallback);
      }
    }
    await saveActivePreset(s);
  }

  async function onRevert() {
    if (s.presets.busy) return;
    await revertActivePreset(s);
  }

  function onCopy() {
    if (s.presets.busy || active == null) return;
    s.copySource.slot = active;
  }
  function onDrop() {
    if (s.presets.busy) return;
    s.copySource.slot = null;
  }

  async function onPaste() {
    if (s.presets.busy) return;
    const src = s.copySource.slot;
    if (src == null) return;
    const r = await pastePresetTo(s, src);
    if ('ok' in r && r.ok) s.copySource.slot = null;
  }

  async function onSetStartup() {
    if (s.presets.busy || active == null) return;
    if (startupMode !== PresetStartupMode.Specified) {
      await setStartupMode(s, PresetStartupMode.Specified);
    }
    await setStartupDefault(s, active);
  }

  const startupLastActive = $derived(startupMode === PresetStartupMode.LastActive);

  function onStartupLastActiveChange(v: boolean) {
    void setStartupMode(s, v ? PresetStartupMode.LastActive : PresetStartupMode.Specified);
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
    <ToggleSwitch
      size="sm"
      label="Master volume"
      ariaLabel="Include master volume in preset"
      checked={mvMode === MasterVolumeMode.WithPreset}
      onChange={(v) => void setMasterVolumeMode(s, v ? MasterVolumeMode.WithPreset : MasterVolumeMode.Independent)}
    />
    <ToggleSwitch
      size="sm"
      label="IO config (pins, types, I2S clock)"
      ariaLabel="Include IO configuration in preset"
      checked={ocMode === OutputConfigMode.WithPreset}
      onChange={(v) => void setOutputConfigMode(s, v ? OutputConfigMode.WithPreset : OutputConfigMode.Independent)}
    />
  </fieldset>

  <div class="divider"></div>

  <fieldset class="group" disabled={!connected || dir == null}>
    <h4>STARTUP MODE</h4>
    <ToggleSwitch
      size="sm"
      label="Boot into last active preset"
      ariaLabel="Boot into last active preset"
      checked={startupLastActive}
      onChange={onStartupLastActiveChange}
    />
    <p class="hint">{startupLastActive
      ? 'Resumes whichever preset was active at power-off.'
      : 'Boots the preset marked as startup (use SET AS STARTUP).'}</p>
  </fieldset>

  <div class="divider"></div>

  <div class="group">
    <h4>OPTIONS</h4>
    <ToggleSwitch
      size="sm"
      label="Warn on preset switch when changes are unsaved"
      ariaLabel="Warn on preset switch when changes are unsaved"
      checked={settings.warnOnPresetSwitchDirty}
      onChange={(v) => { settings.warnOnPresetSwitchDirty = v; }}
    />
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
  .hint {
    margin: 2px 0 0;
    font-family: var(--font-mono);
    font-size: 9px;
    line-height: 1.4;
    color: var(--text-faint);
  }
  .divider {
    height: 1px;
    background: var(--border);
  }
</style>

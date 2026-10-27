<script lang="ts">
  import { onMount } from 'svelte';
  import { settings } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { fetchPresetInfo, retryFetchPresetInfo, setMasterVolumeMode, setOutputConfigMode } from '@/runtime';
  import { MasterVolumeMode, OutputConfigMode } from '@/domain';

  const s = getSession();
  const dir = $derived(s.presets.directory);
  const unknown = $derived(dir == null);

  onMount(() => {
    if (s.presets.directory == null && !s.presets.busy) void fetchPresetInfo(s);
  });
</script>

{#if dir == null && s.presets.lastFetchError}
  <div class="fail">
    <span>{s.presets.lastFetchError}</span>
    <button type="button" class="chip" onclick={() => void retryFetchPresetInfo(s)}>RETRY</button>
  </div>
{/if}
<div class="rows" role="group" aria-label="Device-wide preset options">
  <div class="trow">
    <span>Master volume stored with preset</span>
    <ToggleSwitch size="sm" ariaLabel="Master volume stored with preset" disabled={unknown}
      checked={dir?.masterVolumeMode === MasterVolumeMode.WithPreset}
      onChange={(v) => void setMasterVolumeMode(s, v ? MasterVolumeMode.WithPreset : MasterVolumeMode.Independent)} />
  </div>
  <div class="trow">
    <span>Output config stored with preset</span>
    <ToggleSwitch size="sm" ariaLabel="Output config stored with preset" disabled={unknown}
      checked={dir?.outputConfigMode === OutputConfigMode.WithPreset}
      onChange={(v) => void setOutputConfigMode(s, v ? OutputConfigMode.WithPreset : OutputConfigMode.Independent)} />
  </div>
  <div class="trow">
    <span>Warn when switching with unsaved changes</span>
    <ToggleSwitch size="sm" ariaLabel="Warn when switching with unsaved changes"
      checked={settings.warnOnPresetSwitchDirty}
      onChange={(v) => { settings.warnOnPresetSwitchDirty = v; }} />
  </div>
</div>

<style>
  .rows { display: flex; flex-direction: column; }
  .fail {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--err);
  }
  .fail .chip { height: 20px; padding: 0 8px; font-family: var(--font-sans); font-size: 11px; font-weight: 600; letter-spacing: 0; }
  .trow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 24px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .trow span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trow :global(.sw) { padding: 0; }
</style>

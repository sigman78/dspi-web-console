<!-- src/components/tabs/PresetsTab.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Panel from '../chrome/Panel.svelte';
  import PresetTile from '../presets/PresetTile.svelte';
  import PresetControls from '../presets/PresetControls.svelte';
  import { fetchPresetInfo, retryFetchPresetInfo } from '../../runtime/presets';
  import { presets, presetsDirty, copySource, clearCopySource, session } from '../../state';
  import { PRESET_SLOT_COUNT, type PresetSlot } from '../../domain';

  const SLOTS: PresetSlot[] = Array.from({ length: PRESET_SLOT_COUNT }, (_, i) => i as PresetSlot);
  const connected = $derived(session.status === 'connected');

  // Refs to tile components so the controls pane can trigger inline rename.
  const tileRefs = $state<Record<number, { enterRename: () => void } | null>>({});
  function requestRename() {
    const a = presets.active;
    if (a == null) return;
    tileRefs[a]?.enterRename();
  }

  // COPY/PASTE invariant: source mark clears when RAM goes dirty from a
  // user edit. Preset Load/Paste apply dsp.live and dsp.shadow atomically
  // via fetchAndApplyAsBaseline(), so there is no transient dirty=true
  // window to filter out during wire ops.
  $effect(() => {
    if (presetsDirty.current && copySource.slot != null) {
      clearCopySource();
    }
  });

  onMount(() => {
    void fetchPresetInfo();
    return () => { clearCopySource(); };
  });
</script>

<div class="grid">
  <Panel code="PR.01" title="PRESETS">
    <div class="body-pad">
      {#if !connected}
        <div class="placeholder">Not connected.</div>
      {:else if presets.directory == null && presets.lastFetchError}
        <div class="error">
          <div class="msg">{presets.lastFetchError}</div>
          <button class="retry" onclick={retryFetchPresetInfo} disabled={presets.busy}>RETRY</button>
        </div>
      {:else if presets.directory == null}
        <div class="placeholder">Loading presets…</div>
      {:else}
        <div class="tile-grid">
          {#each SLOTS as slot (slot)}
            <PresetTile {slot} bind:this={tileRefs[slot]} />
          {/each}
        </div>
        {#if presets.lastActionError}
          <div class="action-error">
            <span>{presets.lastActionError}</span>
            <button onclick={() => { presets.lastActionError = null; }} aria-label="Dismiss">×</button>
          </div>
        {/if}
        <div class="legend">
          <span><i class="sw active"></i>active</span>
          <span><i class="dot"></i>dirty</span>
          <span class="boot">★ boot</span>
        </div>
      {/if}
    </div>
  </Panel>

  <Panel code="PR.02" title="CONTROLS">
    <PresetControls onRequestRename={requestRename} />
  </Panel>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: var(--pad);
    align-items: start;
  }
  .body-pad { padding: 14px; display: flex; flex-direction: column; gap: 14px; }
  .tile-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 10px;
  }
  .placeholder {
    padding: 24px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
  }
  .error {
    padding: 20px 24px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--err);
    display: flex; flex-direction: column; gap: 12px; align-items: flex-start;
  }
  .msg { color: var(--err); }
  .retry {
    padding: 4px 12px; border-radius: 3px;
    font-family: inherit; font-size: 10px; letter-spacing: 1px; font-weight: 700;
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--accent) 40%, var(--border));
    color: var(--accent); cursor: pointer;
  }
  .retry:hover:not(:disabled) { border-color: var(--accent); }
  .retry:disabled { opacity: 0.4; cursor: default; }
  .action-error {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px;
    background: color-mix(in oklab, var(--err) 14%, transparent);
    border: 1px solid color-mix(in oklab, var(--err) 45%, var(--border));
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--err);
  }
  .action-error button {
    background: transparent; border: none;
    color: var(--err); cursor: pointer;
    font-size: 16px; line-height: 1; padding: 0 4px;
  }
  .legend {
    display: flex; gap: 14px; flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    padding-top: 10px;
    border-top: 1px solid var(--border);
    letter-spacing: 1px;
  }
  .legend > span { display: inline-flex; align-items: center; gap: 5px; }
  .legend .sw {
    display: inline-block; width: 11px; height: 11px; border-radius: 2px;
    background: color-mix(in oklab, var(--accent) 10%, var(--panel-hi));
    border: 1px solid var(--accent);
  }
  .legend .dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 4px color-mix(in oklab, var(--accent) 60%, transparent);
  }
  .legend .boot { color: var(--warn); font-size: 11px; }
</style>

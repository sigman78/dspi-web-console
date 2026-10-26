<script lang="ts">
  // The control-surface save lifecycle: the fw keeps a single dirty flag over
  // bindings, groups, macros and display, so SAVE/DISCARD are device-wide.
  // cs.changed names the editors that applied since the last save;
  // cs.staged counts edits not yet applied (and so not part of a SAVE).
  import Panel from '@/components/chrome/Panel.svelte';
  import { csSaveConfig, csRevertConfig } from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { csChangesModel } from '@/components/system/csChangesModel';

  const s = getSession();
  const m = $derived(csChangesModel(s));
  const dirty = $derived(m.dirty);
  const changedText = $derived(m.changedText);
  const stagedTotal = $derived(m.stagedTotal);
  const stagedText = $derived(m.stagedText);

  let applying = $state(false);

  async function save(): Promise<void> {
    applying = true;
    try { await csSaveConfig(s); } finally { applying = false; }
  }
  async function discard(): Promise<void> {
    applying = true;
    try { await csRevertConfig(s); } finally { applying = false; }
  }
</script>

<Panel code="CT.06" title="CHANGES">
  {#snippet right()}
    {#if dirty}
      <span class="unsaved" title="Live preview — not yet written to flash">UNSAVED</span>
    {/if}
  {/snippet}

  <div class="body">
    <div class="line">
      <span class="microlbl">CHANGED</span>
      {#if dirty}
        <span class="val accent">{changedText || 'on device'}</span>
      {:else}
        <span class="val off">nothing</span>
      {/if}
    </div>
    {#if stagedTotal > 0}
      <div class="line">
        <span class="microlbl">UNAPPLIED</span>
        <span class="val warn" title="Not part of SAVE — APPLY in the panel first">{stagedText}</span>
      </div>
    {/if}
    <div class="actions">
      <button type="button" class="chip accent" disabled={applying || !dirty} onclick={save}
        title="Write the applied controls to flash">SAVE</button>
      <button type="button" class="chip hi" disabled={applying || (!dirty && stagedTotal === 0)} onclick={discard}
        title="Rewind every control-surface setting to the saved set">DISCARD</button>
    </div>
  </div>
</Panel>

<style>
  .unsaved {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--accent);
    white-space: nowrap;
  }
  .body { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 6px; }
  .line { display: flex; align-items: baseline; gap: 10px; }
  .line .microlbl { width: 70px; }
  .val { font-family: var(--font-mono); font-size: 10px; font-weight: 600; }
  .val.accent { color: var(--accent); }
  .val.warn { color: var(--warn); }
  .val.off { color: var(--text-faint); font-weight: 400; }
  .actions { display: flex; gap: 8px; padding-top: 4px; }
</style>

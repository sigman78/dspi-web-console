<script lang="ts">
  // Compact form of the CHANGES panel for the CONTROL page-selector row: same
  // device-wide SAVE/DISCARD lifecycle, same disabled rules.
  import { csSaveConfig, csRevertConfig } from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { csChangesModel } from '@/components/system/csChangesModel';

  const s = getSession();
  const m = $derived(csChangesModel(s));

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

<div class="strip" role="group" aria-label="Control-surface changes">
  {#if m.dirty}
    <span class="unsaved" title="Live preview — not yet written to flash">UNSAVED</span>
  {/if}
  <span class="changed" title={m.dirty ? m.changedText || 'on device' : undefined}>changed</span>
  {#if m.stagedTotal > 0}
    <span class="warn" title={m.stagedText}>unapplied {m.stagedTotal}</span>
  {/if}
  <button type="button" class="chip accent" disabled={applying || !m.dirty} onclick={save}
    title="Write the applied controls to flash">SAVE</button>
  <button type="button" class="chip hi" disabled={applying || (!m.dirty && m.stagedTotal === 0)} onclick={discard}
    title="Rewind every control-surface setting to the saved set">DISCARD</button>
</div>

<style>
  .strip { display: flex; align-items: center; gap: 10px; height: 28px; min-width: 0; }
  .unsaved {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--accent);
    white-space: nowrap;
    padding: 2px 6px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-m);
  }
  .changed, .warn { font-size: 11px; white-space: nowrap; }
  .changed { color: var(--text-dim); }
  .warn { color: var(--warn); }
</style>

<script lang="ts">
  // Compact form of the CHANGES panel for the CONTROL page-selector row: same
  // device-wide SAVE/DISCARD lifecycle, same disabled rules.
  import { csSaveConfig, csRevertConfig } from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { csChangesModel } from '@/components/system/csChangesModel';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import PresetIcon from '@/components/noveau/presets/PresetIcon.svelte';

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
    <span class="unsaved" title="Live preview — not yet written to flash">
      <PresetIcon icon="save" />
      <span class="changed" title={m.changedText || 'on device'}>changed</span>
    </span>
  {/if}
  {#if m.draftTotal > 0}
    <span class="draft count" title={m.draftText}>unapplied {m.draftTotal}</span>
  {/if}
  <button type="button" class="chip accent" disabled={applying || !m.dirty} onclick={save}
    title="Write the applied controls to flash">SAVE</button>
  <ConfirmButton
    label="DISCARD"
    confirmLabel="DISCARD?"
    extraClass="hi"
    tone="warn"
    disabled={applying || (!m.dirty && m.draftTotal === 0)}
    title="Rewind every control-surface setting to the saved set"
    onConfirm={() => void discard()}
  />
</div>

<style>
  .strip { display: flex; align-items: center; gap: 10px; height: 28px; min-width: 0; }
  .unsaved {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--warn);
    padding-bottom: 1px;
    border-bottom: 1px solid var(--warn);
    white-space: nowrap;
  }
  .changed, .count { font-size: 11px; white-space: nowrap; }
  .changed { color: var(--text-dim); }
  .count { color: var(--text-dim); padding-right: 10px; }
  .count.draft::after { top: 50%; right: 0; margin-top: -3px; }
</style>

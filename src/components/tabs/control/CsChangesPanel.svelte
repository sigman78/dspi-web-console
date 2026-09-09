<script lang="ts">
  // The control-surface save lifecycle in one line: the fw keeps a single
  // dirty flag over bindings, groups, macros and display, so SAVE/DISCARD are
  // device-wide. Staged counts come from each editor panel (cs.staged) --
  // an unapplied edit is not part of a SAVE.
  import Panel from '@/components/chrome/Panel.svelte';
  import { connection } from '@/state';
  import { csSaveConfig, csRevertConfig } from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import * as CsField from '@/components/system/csFieldHelpers';

  const s = getSession();
  const connected = $derived(connection.connected);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);
  const dirty = $derived(cs.status?.dirty === true);

  const stagedRows = $derived([
    { label: 'CONTROLS', n: cs.staged.bindings, show: true },
    { label: 'GROUPS', n: cs.staged.groups, show: CsField.groupsAvailable(caps) },
    { label: 'MACROS', n: cs.staged.macros, show: CsField.macrosAvailable(caps) },
    { label: 'DISPLAY', n: cs.staged.display, show: CsField.displaysAvailable(caps) },
  ].filter((r) => r.show));
  const stagedTotal = $derived(stagedRows.reduce((a, r) => a + r.n, 0));
  const stagedText = $derived(stagedRows.filter((r) => r.n > 0).map((r) => `${r.label} ${r.n}`).join(', '));

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
    <button type="button" class="chip accent" disabled={!connected || applying || !dirty} onclick={save}>SAVE</button>
    <button type="button" class="chip hi" disabled={!connected || applying || (!dirty && stagedTotal === 0)} onclick={discard}>DISCARD</button>
  {/snippet}

  <div class="line" class:warn={stagedTotal > 0} class:off={!dirty && stagedTotal === 0}>
    {#if dirty}
      Controls run as a live preview, not in flash — SAVE keeps them, DISCARD rewinds to the saved set.
    {:else}
      Controls match the saved set.
    {/if}
    {#if stagedTotal > 0}
      {stagedTotal} unapplied {stagedTotal === 1 ? 'edit' : 'edits'} ({stagedText}) {stagedTotal === 1 ? 'is' : 'are'} left out of SAVE — APPLY first.
    {/if}
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
  .line {
    padding: 10px 14px;
    font-family: var(--font-mono);
    font-size: 9px;
    line-height: 1.5;
    color: var(--text-dim);
  }
  .line.warn { color: var(--warn); }
  .line.off { color: var(--text-faint); }
</style>

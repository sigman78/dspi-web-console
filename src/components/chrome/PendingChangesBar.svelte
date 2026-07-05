<script lang="ts">
  import { activeSession } from '@/state';

  const s = $derived(activeSession());
  const entries = $derived(s?.staging.entries ?? []);
  const applying = $derived(s?.staging.applying ?? false);
  const busy = $derived(s?.writes.busy ?? false);

  function applyAll() { void s?.staging.applyAll(); }
  function discardAll() { s?.staging.discardAll(); }
  function discardOne(key: string) { s?.staging.discard(key); }
</script>

{#if entries.length > 0 || applying}
  <div class="bar" role="region" aria-label="Pending changes">
    <span class="label">PENDING · {entries.length}</span>
    <div class="chips">
      {#each entries as e (e.key)}
        <span class="entry">
          {e.label} {e.from}→{e.to}
          <button type="button" class="x" aria-label={`Discard ${e.label}`} disabled={applying} onclick={() => discardOne(e.key)}>✕</button>
        </span>
      {/each}
    </div>
    <span class="note">applies together — brief audio mute</span>
    <div class="actions">
      <button type="button" class="chip accent md" disabled={applying || busy} onclick={applyAll}>APPLY</button>
      <button type="button" class="chip hi md" disabled={applying} onclick={discardAll}>DISCARD</button>
    </div>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 8px 16px;
    background: color-mix(in oklab, var(--accent) 8%, var(--panel));
    border-bottom: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .label {
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--accent);
    white-space: nowrap;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
  .entry {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: var(--radius-s);
    background: var(--wash);
    border: 1px solid var(--border-hi);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .x {
    background: none;
    border: none;
    color: var(--text-faint);
    cursor: pointer;
    padding: 0;
    font-size: 9px;
    line-height: 1;
  }
  .x:hover:not(:disabled) { color: var(--err); }
  .x:disabled { opacity: var(--dim-disabled); cursor: default; }
  .note { color: var(--text-faint); white-space: nowrap; }
  .actions { display: flex; gap: 6px; flex: none; }
</style>

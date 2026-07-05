<script lang="ts">
  import { activeSession } from '@/state';

  const s = $derived(activeSession());
  const entries = $derived(s?.staging.entries ?? []);
  const applying = $derived(s?.staging.applying ?? false);
  const busy = $derived(s?.writes.busy ?? false);

  const summary = $derived(entries.map((e) => `${e.label} ${e.from}→${e.to}`).join('\n'));

  function applyAll() { void s?.staging.applyAll(); }
  function discardAll() { s?.staging.discardAll(); }
</script>

{#if entries.length > 0 || applying}
  <div class="bar" role="region" aria-label="Pending changes">
    <span class="label" title={summary}>PENDING · {entries.length}</span>
    <span class="note">applies together — brief audio mute</span>
    <div class="actions">
      <button type="button" class="chip accent md" disabled={applying || busy} onclick={applyAll}>APPLY</button>
      <button type="button" class="chip hi md" disabled={applying} onclick={discardAll}>DISCARD</button>
    </div>
  </div>
{/if}

<style>
  /* Floating dock: fixed at bottom-center so appearing never displaces the
     page. z-index 90 sits above tab content but below the Toaster (100) and
     PresetBoundaryModal (1000); the bottom-right toast stack keeps priority
     if the two ever overlap on a narrow viewport. */
  .bar {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 90;
    max-width: min(920px, calc(100vw - 32px));
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 8px 16px;
    background: color-mix(in oklab, var(--accent) 8%, var(--panel-solid));
    border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
    border-radius: var(--radius-m);
    box-shadow: 0 4px 14px oklch(0% 0 0 / 0.4);
    font-family: var(--font-mono);
    font-size: 10px;
    animation: bar-enter 150ms ease-out;
  }
  @keyframes bar-enter {
    from { opacity: 0; transform: translateX(-50%) translateY(6px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar { animation: none; }
  }
  .label {
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--accent);
    white-space: nowrap;
  }
  .note { color: var(--text-faint); white-space: nowrap; }
  .actions { display: flex; gap: 6px; flex: none; }
</style>

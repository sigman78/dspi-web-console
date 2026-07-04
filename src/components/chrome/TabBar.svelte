<script lang="ts">
  import { settings, setTab, TAB_ORDER, TAB_META, connection } from '@/state';

  const TABS = TAB_ORDER.map((id) => ({ id, ...TAB_META[id] }));
  const disabled = $derived(!connection.connected);
</script>

<div class="tabs" class:is-disabled={disabled}>
  <div class="row">
    {#each TABS as t (t.id)}
      <button
        class="tab"
        class:active={settings.tab === t.id}
        disabled={disabled}
        onclick={() => setTab(t.id)}
      >
        <span class="tcode">{t.code}</span>
        <span class="tlabel">{t.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .tabs {
    display: flex;
    align-items: stretch;
  }
  /* U-P3 policy B: no whole-bar dim when disconnected (tab codes/labels are
     structure, stay full-contrast). pointer-events still blocks interaction;
     each .tab carries the single dim layer via its own :disabled rule. */
  .tabs.is-disabled {
    pointer-events: none;
  }
  .row {
    display: flex;
    align-items: stretch;
    gap: 14px;
    height: 100%;
    font-family: var(--font-mono);
  }
  .tab {
    padding: 10px 12px;
    border-radius: 0;
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: 10px;
    letter-spacing: 1.2px;
    font-weight: 600;
    cursor: pointer;
    display: flex; gap: 6px; align-items: baseline;
    transition: background 100ms, color 100ms, box-shadow 100ms;
  }
  .tab:disabled { opacity: var(--dim-disabled); cursor: default; }
  .tab.active {
    background:
      linear-gradient(to top,
        color-mix(in oklab, var(--accent) 25%, transparent) 0%,
        color-mix(in oklab, var(--accent) 10%, transparent) 40%,
        color-mix(in oklab, var(--accent) 6%, transparent) 100%),
      color-mix(in oklab, var(--accent) 8%, transparent);
    color: var(--accent);
    box-shadow:
      inset 0 -2px 0 0 var(--accent),
      inset 0 -10px 16px -6px color-mix(in oklab, var(--accent) 28%, transparent);
  }
  .tcode { color: var(--text-faint); font-size: 9px; }
  .tlabel { font-size: 10px; }
  @media (max-width: 1160px) {
    .tab:not(.active) .tlabel { display: none; }
  }
  .tab.active .tcode { color: color-mix(in oklab, var(--accent) 70%, transparent); }
</style>

<script lang="ts">
  import { settings, setTab, TAB_ORDER, TAB_META, connection, activeSession } from '@/state';

  // "Initialized" = a ready session whose capabilities are known. Until then we
  // render a skeleton rather than the tab buttons: the tab set is
  // capability-dependent (CONTROL is V16-only), so showing real tabs before the
  // device is known means guessing -- which is what made CONTROL appear
  // speculatively and then vanish on a V10 connect.
  const ready = $derived(connection.connected);

  // CONTROL hosts V16-only panels; include it only when the connected device
  // actually exposes a control feature. Read only in the ready branch, where
  // capabilities.features is guaranteed non-null.
  const controlSupported = $derived.by(() => {
    const f = activeSession()?.device.capabilities.features;
    return !!(f && (f.controlInterfaces || f.controlSurfaces));
  });
  const tabs = $derived(
    TAB_ORDER
      .filter((id) => id !== 'control' || controlSupported)
      .map((id) => ({ id, ...TAB_META[id] })),
  );

  // The skeleton mirrors the always-present tabs (everything but CONTROL), so
  // the placeholder occupies the real bar's width and the swap-in doesn't shift
  // layout. The label/code text is present but visually hidden -- it only sizes
  // each slot to match its real tab.
  const skeletonTabs = TAB_ORDER.filter((id) => id !== 'control').map((id) => ({ id, ...TAB_META[id] }));
</script>

{#if ready}
  <div class="tabs is-real">
    <div class="row">
      {#each tabs as t (t.id)}
        <button
          class="tab"
          class:active={settings.tab === t.id}
          onclick={() => setTab(t.id)}
        >
          <span class="tcode">{t.code}</span>
          <span class="tlabel">{t.label}</span>
        </button>
      {/each}
    </div>
  </div>
{:else}
  <div class="tabs is-skel" aria-hidden="true">
    <div class="row">
      {#each skeletonTabs as t (t.id)}
        <span class="tab tab-skel">
          <span class="tcode">{t.code}</span>
          <span class="tlabel">{t.label}</span>
        </span>
      {/each}
    </div>
  </div>
{/if}

<style>
  .tabs {
    display: flex;
    align-items: stretch;
  }
  /* Ease the real tabs in when they replace the skeleton on connect. */
  .tabs.is-real { animation: tabs-in 0.15s ease-out both; }
  /* Hold the skeleton invisible for ~100ms before fading it in, so a fast
     connect lands the real tabs first and the skeleton never blinks into view. */
  .tabs.is-skel { animation: tabs-in 0.15s ease-out 0.1s both; }
  @keyframes tabs-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tabs.is-real, .tabs.is-skel { animation: none; }
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

  /* Skeleton placeholder: same box (so it sizes to the real tabs), text hidden,
     a neutral inset bar standing in for the label. Static -- the bar can sit on
     the idle connect screen indefinitely, so no perpetual shimmer. */
  .tab-skel {
    position: relative;
    cursor: default;
  }
  /* Hide both the code and the label (each has its own color) -- the text is
     only there to size the slot to its real tab. */
  .tab-skel .tcode,
  .tab-skel .tlabel { color: transparent; }
  .tab-skel::before {
    content: '';
    position: absolute;
    inset: 9px 2px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--text) 12%, transparent);
  }
</style>

<script lang="ts">
  import { tick } from 'svelte';
  import { boundary, resolveBoundary } from '@/state';

  let panel = $state<HTMLElement>();
  let cancelBtn = $state<HTMLButtonElement>();
  let opener: Element | null = null;

  $effect(() => {
    if (boundary.pending == null) return;
    opener = document.activeElement;
    void tick().then(() => cancelBtn?.focus());
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
      opener = null;
    };
  });

  function onKey(e: KeyboardEvent) {
    if (boundary.pending == null) return;
    if (e.key === 'Escape') { e.preventDefault(); resolveBoundary('cancel'); return; }
    if (e.key !== 'Tab' || !panel) return;
    const btns = panel.querySelectorAll<HTMLButtonElement>('button');
    if (btns.length === 0) return;
    const first = btns[0];
    const last = btns[btns.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || !panel.contains(cur))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (cur === last || !panel.contains(cur))) { e.preventDefault(); first.focus(); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if boundary.pending}
  <div class="scrim" role="dialog" aria-modal="true" aria-labelledby="bdry-title">
    <div class="panel" bind:this={panel}>
      <h2 id="bdry-title">{boundary.pending.title}</h2>
      <p>{boundary.pending.message}</p>
      <div class="actions">
        <button class="chip md" bind:this={cancelBtn} onclick={() => resolveBoundary('cancel')}>Cancel</button>
        <button class="chip md warn" onclick={() => resolveBoundary('discard')}>{boundary.pending.discardLabel ?? 'Switch anyway'}</button>
        {#if boundary.pending.saveLabel}
          <button class="chip md accent" onclick={() => resolveBoundary('save')}>{boundary.pending.saveLabel}</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0;
    background: var(--scrim);
    backdrop-filter: blur(6px);
    display: grid; place-items: center;
    z-index: var(--z-modal);
    font-family: var(--font-mono);
  }
  .panel {
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-m);
    padding: 18px 20px;
    min-width: 360px;
    max-width: 480px;
    color: var(--text);
  }
  h2 { font-size: var(--fs-l); font-weight: 600; margin: 0 0 8px; color: var(--text); }
  p  { font-size: 11px; color: var(--text-dim); margin: 0 0 16px; line-height: 1.4; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>

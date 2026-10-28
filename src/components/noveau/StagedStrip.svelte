<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import { tick } from 'svelte';
  import { dismiss } from '@/components/chrome/dismiss';

  const { rule = false }: { rule?: boolean } = $props();

  const s = getSession();
  const entries = $derived(s.staging.entries);
  const applying = $derived(s.staging.applying);
  const busy = $derived(s.writes.busy);
  const staged = $derived(entries.length > 0 || applying);
  const disruptive = $derived(s.staging.disruptive);
  let listOpen = $state(false);
  const open = $derived(listOpen && entries.length > 0);
  let countBtn = $state<HTMLButtonElement>();
  let pop = $state<HTMLElement>();

  async function closeList(e: Event): Promise<void> {
    const refocus = e instanceof KeyboardEvent && (pop?.contains(document.activeElement) ?? false);
    listOpen = false;
    if (refocus) {
      await tick();
      countBtn?.focus();
    }
  }

  // The clicked row leaves the DOM, so focus moves to a neighbouring ✕, the
  // count, or the selected page tab once the strip itself is gone.
  async function discardOne(key: string): Promise<void> {
    const at = entries.findIndex((e) => e.key === key);
    s.staging.discard(key);
    await tick();
    const xs = pop ? [...pop.querySelectorAll<HTMLButtonElement>('.x-btn')] : [];
    const next = xs[Math.min(at, xs.length - 1)];
    if (next) next.focus();
    else if (countBtn?.isConnected) countBtn.focus();
    else document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }
</script>

{#if staged}
  <div class="strip" role="group" aria-label="Staged changes">
    <span class="dot"></span>
    <span class="list-wrap">
      <button type="button" class="staged-count" bind:this={countBtn} aria-expanded={open} onclick={() => { listOpen = !open; }}>{entries.length} {entries.length === 1 ? 'change' : 'changes'}</button>
      {#if open}
        <div class="pop" role="dialog" aria-label="Staged changes" bind:this={pop} use:dismiss={{ onDismiss: (e) => void closeList(e), ignore: '.staged-count' }}>
          {#each entries as e (e.key)}
            <div class="item">
              <span class="lbl">{e.label}</span>
              <span class="chg">{e.from}→{e.to}</span>
              <button type="button" class="x-btn" title="Discard this change" aria-label={`Discard ${e.label}`} disabled={applying} onclick={() => void discardOne(e.key)}>✕</button>
            </div>
          {/each}
        </div>
      {/if}
    </span>
    {#if disruptive}
      <span class="why" class:danger={disruptive.tone === 'danger'} title={disruptive.reason}>{disruptive.reason}</span>
      <ConfirmButton
        label="APPLY"
        confirmLabel="CONFIRM"
        extraClass="accent md"
        tone={disruptive.tone}
        disabled={applying || busy}
        title="Applies together — brief audio mute"
        onConfirm={() => void s.staging.applyAll()}
      />
    {:else}
      <button type="button" class="chip md accent" title="Applies together — brief audio mute" disabled={applying || busy} onclick={() => void s.staging.applyAll()}>APPLY</button>
    {/if}
    <ConfirmButton
      label="DISCARD"
      confirmLabel="DISCARD?"
      extraClass="hi md"
      tone="warn"
      disabled={applying}
      title="Drop every staged change"
      onConfirm={() => s.staging.discardAll()}
    />
  </div>
  {#if rule}<span class="rule" aria-hidden="true"></span>{/if}
{/if}

<style>
  .strip { display: flex; align-items: center; gap: 10px; height: 28px; min-width: 0; font-size: 11px; color: var(--text-dim); }
  .list-wrap { position: relative; }
  .staged-count {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 500;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .staged-count:hover { color: var(--text); }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 10px);
    z-index: var(--z-flyout);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 260px;
    padding: 10px;
    border-radius: var(--radius);
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    box-shadow: var(--shadow-flyout);
  }
  .item { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; }
  .lbl { color: var(--text); white-space: nowrap; }
  .chg { font-family: var(--font-mono); color: var(--text-dim); white-space: nowrap; }
  .why { color: var(--warn); white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
  .why.danger { color: var(--err); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); flex: none; }
  .rule { width: 1px; height: 16px; background: var(--border-hi); flex: none; }
</style>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import NameField from '@/components/chrome/NameField.svelte';
  import { dismiss } from '@/components/chrome/dismiss';

  // Rendered inside an anchor host, then floated to <body> at the host's
  // bottom-left so panel overflow clipping cannot cut it off.
  const { title, value, onCommit, onCancel }: {
    title: string;
    value: string;
    onCommit: (name: string) => void;
    onCancel: () => void;
  } = $props();

  let text = $state(untrack(() => value));
  let field: NameField | undefined;

  const opener = document.activeElement;

  onMount(() => {
    field?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  });

  function submit(): void {
    void field?.commit();
    onCommit(text);
  }

  function float(node: HTMLElement): { destroy(): void } {
    const host = node.parentElement;
    if (host) {
      const r = host.getBoundingClientRect();
      node.style.left = `${Math.round(r.left + 14)}px`;
      node.style.top = `${Math.round(r.bottom)}px`;
    }
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="pop" role="dialog" aria-label={title} tabindex="-1"
  onkeydown={onKey} use:float use:dismiss={{ onDismiss: onCancel }}>
  <span class="microlbl">{title}</span>
  <NameField bind:this={field} class="namein" allowEmpty maxlength={31} placeholder="Unnamed"
    value={text} ariaLabel="Name" onCommit={(n) => { text = n; }} />
  <div class="actions">
    <button type="button" class="chip" onclick={onCancel}>CANCEL</button>
    <button type="button" class="chip" data-safe onclick={submit}>OK</button>
  </div>
</div>

<style>
  .pop {
    position: fixed;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-sizing: border-box;
    width: 220px;
    padding: 8px;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-s);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.35);
    color: var(--text);
  }
  .pop :global(.namein) {
    font-family: var(--font-mono);
    font-size: 11px;
    box-sizing: border-box;
    width: 100%;
    height: 24px;
    padding: 0 6px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
  }
  .actions { display: flex; gap: 6px; justify-content: flex-end; }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import NameField from '@/components/chrome/NameField.svelte';
  import { clampToBounds, dismiss } from '@/components/chrome/dismiss';
  import * as Runtime from '@/runtime';
  import * as Domain from '@/domain';
  import { getSession } from '@/components/sessionContext';

  // Rendered inside the panel body, then floated to <body> at the bottom-left of
  // its host so panel overflow cannot clip it and it sits below the source row.
  const { id, ignore, onClose }: {
    id: string;
    /** Selector of the opener that toggles this popover itself. */
    ignore: string;
    onClose: () => void;
  } = $props();

  const s = getSession();
  const caps = $derived(s.device.capabilities);
  const numbered = $derived(caps.spdifInputCount > 1);
  const sources = $derived(Domain.selectableInputSources(caps.spdifInputCount, caps.features.adatInput));

  let pop: HTMLElement | undefined;

  const opener = document.activeElement;

  onMount(() => {
    pop?.querySelector('input')?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  });

  // Blurring first lets a typed-but-uncommitted field stage through its normal blur handler.
  function close(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && pop?.contains(active)) active.blur();
    onClose();
  }

  function float(node: HTMLElement): { destroy(): void } {
    const host = node.parentElement;
    if (host) {
      const r = host.getBoundingClientRect();
      node.style.left = `${Math.round(r.left + 14)}px`;
      node.style.top = `${Math.round(r.bottom)}px`;
    }
    document.body.appendChild(node);
    const box = node.getBoundingClientRect();
    const at = clampToBounds(box.left, box.top, box.width, box.height, window.innerWidth, window.innerHeight);
    node.style.left = `${Math.round(at.left)}px`;
    node.style.top = `${Math.round(at.top)}px`;
    return { destroy() { node.remove(); } };
  }
</script>

<div class="pop" {id} role="dialog" aria-label="Input source names" tabindex="-1"
  bind:this={pop} use:float use:dismiss={{ onDismiss: close, ignore }}>
  {#each sources as src (src)}
    {@const label = Domain.inputSourceLabel(src, numbered)}
    <span class="lbl">{label}</span>
    {@const key = `inputSourceName:${src}`}
    {@const live = s.names.inputSources[src] ?? ''}
    <span class="stage-wrap" class:staged={s.staging.has(key)} title={s.staging.has(key) ? `device: ${live || 'built-in'}` : undefined}>
      <NameField class="namein" allowEmpty maxlength={Domain.DEVICE_NAME_MAX_LEN} placeholder={label} disabled={s.staging.applying}
        value={s.staging.valueOf(key, live)} ariaLabel={`Name for ${label}`}
        onCommit={(name) => Runtime.stageInputSourceName(s, src, name)} />
    </span>
  {/each}
</div>

<style>
  .pop {
    position: fixed;
    z-index: 20;
    display: grid;
    grid-template-columns: auto 15em;
    align-items: center;
    gap: 6px 10px;
    box-sizing: border-box;
    max-width: calc(100vw - 16px);
    padding: 8px;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-s);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.35);
    color: var(--text);
  }
  .stage-wrap { display: block; }
  .lbl {
    font-family: var(--font-sans);
    font-size: var(--fs-m);
    color: var(--text-dim);
    white-space: nowrap;
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
</style>

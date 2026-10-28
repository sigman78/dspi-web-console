<script lang="ts">
  import { untrack } from 'svelte';

  const {
    value,
    maxlength,
    placeholder,
    ariaLabel,
    disabled = false,
    editing = false,
    allowEmpty = false,
    class: className,
    onCommit,
    onCancel,
    onKeyExit,
  }: {
    value: string;
    maxlength?: number;
    placeholder?: string;
    ariaLabel: string;
    disabled?: boolean;
    /** Mounted only for the duration of one edit: takes focus with the text selected, Escape always cancels, and every edit ends in onCommit or onCancel. */
    editing?: boolean;
    /** Commit an emptied field instead of rejecting it. */
    allowEmpty?: boolean;
    class?: string;
    /** Receives the trimmed name; skipped for an unchanged name unless `editing`. */
    onCommit: (name: string) => void | Promise<void>;
    onCancel?: () => void;
    /** Enter or Escape ended the edit (as opposed to focus moving away). */
    onKeyExit?: () => void;
  } = $props();

  let el = $state<HTMLInputElement | null>(null);
  // An editing field is uncontrolled so re-renders cannot clobber typing; this
  // flag makes the blur that follows its unmount a no-op after Enter/Escape.
  let done = false;

  function init(node: HTMLInputElement) {
    done = false;
    node.value = untrack(() => value);
    if (untrack(() => editing)) {
      node.focus();
      node.select();
    }
  }

  $effect(() => {
    const v = value;
    if (el && document.activeElement !== el) el.value = v;
  });

  export function focus(): void {
    el?.focus();
    el?.select();
  }

  /** Commit the current draft now (e.g. before a Save that would otherwise race the blur). */
  export async function commit(): Promise<void> {
    if (!el) return;
    if (editing) {
      if (done) return;
      done = true;
    }
    const next = el.value.trim();
    const rejected = next.length === 0 && !allowEmpty;
    if (rejected || (!editing && next === value)) {
      el.value = value;
      if (editing) onCancel?.();
      return;
    }
    el.value = next;
    await onCommit(next);
    if (!editing && el) el.value = value;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onKeyExit?.();
      if (editing) void commit();
      else el?.blur();
    } else if (e.key === 'Escape') {
      if (!editing) {
        // A pristine field lets Escape reach the surface that owns it.
        if (el?.value === value) return;
        e.preventDefault();
        el!.value = value;
        el?.blur();
        return;
      }
      e.preventDefault();
      done = true;
      onKeyExit?.();
      onCancel?.();
    }
  }
</script>

<input
  bind:this={el}
  class={className}
  type="text"
  use:init
  {maxlength}
  {placeholder}
  {disabled}
  spellcheck="false"
  autocomplete="off"
  aria-label={ariaLabel}
  onkeydown={onKeyDown}
  onblur={() => void commit()}
/>

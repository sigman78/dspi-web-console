<script lang="ts">
  import { CODE_LENGTH } from '@/runtime/remote/relayWire';
  import { onMount } from 'svelte';
  import { codeChars, pastedCode } from './codeInput';

  const { value, disabled = false, onChange, onSubmit }: {
    value: string;
    disabled?: boolean;
    onChange: (next: string) => void;
    onSubmit?: () => void;
  } = $props();

  const cellIndexes = Array.from({ length: CODE_LENGTH }, (_, i) => i);
  const inputs: (HTMLInputElement | undefined)[] = [];

  function focusCell(i: number): void {
    inputs[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus();
  }

  onMount(() => { focusCell(value.length); });

  function removeAt(i: number): void {
    if (i < value.length) onChange(value.slice(0, i) + value.slice(i + 1));
  }

  // Typed text lands at the cell and moves on; the field keeps no gaps.
  function onInput(e: Event, i: number): void {
    const el = e.currentTarget as HTMLInputElement;
    // Deleting reaches us as an input event too (soft keyboards, cut, IME).
    if (el.value === '' || (e as InputEvent).inputType?.startsWith('delete')) {
      removeAt(i);
      el.value = value[i] ?? '';
      return;
    }
    let typed = codeChars(el.value);
    const old = value[i];
    // A key typed with the caret after the old character: only the new one counts.
    if (old !== undefined && el.value.length === 2) typed = codeChars(el.value.replace(old, ''));
    const at = Math.min(i, value.length);
    if (typed.length > 0) {
      onChange((value.slice(0, at) + typed + value.slice(at + 1)).slice(0, CODE_LENGTH));
      focusCell(at + typed.length);
    }
    // Rejected characters must not stay visible in the cell.
    el.value = value[i] ?? '';
  }

  function onPaste(e: ClipboardEvent, i: number): void {
    e.preventDefault();
    const pasted = pastedCode(e.clipboardData?.getData('text') ?? '');
    if (pasted.length === 0) return;
    if (pasted.length > 1) {
      onChange(pasted);
      focusCell(pasted.length);
    } else {
      const at = Math.min(i, value.length);
      onChange((value.slice(0, at) + pasted + value.slice(at + 1)).slice(0, CODE_LENGTH));
      focusCell(at + 1);
    }
  }

  function onKeydown(e: KeyboardEvent, i: number): void {
    switch (e.key) {
      case 'Backspace':
        e.preventDefault();
        if (i < value.length) {
          removeAt(i);
        } else if (i > 0) {
          onChange(value.slice(0, i - 1) + value.slice(i));
          focusCell(i - 1);
        }
        return;
      case 'Delete':
        e.preventDefault();
        removeAt(i);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        focusCell(i - 1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        focusCell(i + 1);
        return;
      case 'Enter':
        onSubmit?.();
        return;
    }
  }
</script>

<div class="code" role="group" aria-label="Pairing code">
  {#each cellIndexes as i (i)}
    <input
      bind:this={inputs[i]}
      class="cell"
      type="text"
      value={value[i] ?? ''}
      {disabled}
      aria-label={`Code character ${i + 1}`}
      autocomplete="off"
      inputmode="text"
      autocapitalize="characters"
      enterkeyhint="go"
      spellcheck="false"
      oninput={(e) => { onInput(e, i); }}
      onpaste={(e) => { onPaste(e, i); }}
      onkeydown={(e) => { onKeydown(e, i); }}
      onfocus={(e) => { e.currentTarget.select(); }}
    />
    {#if i === CODE_LENGTH / 2 - 1}<span class="dash" aria-hidden="true">-</span>{/if}
  {/each}
</div>

<style>
  .code { display: flex; align-items: center; gap: 4px; }
  .cell {
    width: 26px;
    height: 32px;
    box-sizing: border-box;
    padding: 0;
    text-align: center;
    text-transform: uppercase;
    font-family: var(--font-mono);
    font-size: var(--fs-xl);
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-s);
  }
  .cell:focus { outline: none; border-color: var(--accent); box-shadow: var(--focus-ring); }
  .cell:disabled { opacity: var(--dim-disabled); }
  .dash { color: var(--text-faint); font-family: var(--font-mono); }
</style>

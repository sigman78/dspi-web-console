<script lang="ts">
  // Two-step arm/confirm mechanics shared by every "dangerous or persisting
  // action" button (firmware update, staged apply, output-config save,
  // band reset, AutoEQ delete).
  // The primitive owns only the state machine and a11y wiring; tone/size and
  // the confirm action itself stay with the caller.
  const {
    label,
    confirmLabel,
    onConfirm,
    disabled = false,
    tone,
    toneAlways = false,
    extraClass = '',
    title,
    ariaLabel,
  }: {
    label: string;
    confirmLabel: string;
    onConfirm: () => void;
    disabled?: boolean;
    tone?: 'danger' | 'warn';
    // false (default): tone only paints the button while armed (the
    // SaveOutputConfigButton idiom -- neutral at rest). true: tone is
    // persistent regardless of arm state (the DevicePanel idiom).
    toneAlways?: boolean;
    extraClass?: string;
    title?: string;
    ariaLabel?: string;
  } = $props();

  let armed = $state(false);

  // Native `disabled` removes the button from the a11y/keyboard tree. Use
  // aria-disabled instead and gate the handlers by hand, so the button stays
  // focusable.
  function onClick(): void {
    if (disabled) return;
    if (!armed) { armed = true; return; }
    armed = false;
    onConfirm();
  }
  function disarm(): void {
    armed = false;
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (armed) e.preventDefault();
      armed = false;
      (e.currentTarget as HTMLElement).blur();
    }
  }
</script>

<button
  type="button"
  class="chip {extraClass}"
  class:armed
  class:danger={tone === 'danger' && (toneAlways || armed)}
  class:warn={tone === 'warn' && (toneAlways || armed)}
  onclick={onClick}
  onblur={disarm}
  onkeydown={onKeydown}
  aria-disabled={disabled}
  {title}
  aria-label={ariaLabel}
><span class="faces"><span class="face" class:hide={armed} aria-hidden={armed}>{label}</span><span class="face" class:hide={!armed} aria-hidden={!armed}>{confirmLabel}</span></span></button>

<style>
  /* Both labels occupy the same cell so arming never changes the width. */
  .faces { display: inline-grid; }
  .face { grid-area: 1 / 1; white-space: nowrap; }
  .face.hide { visibility: hidden; }
  .chip[aria-disabled="true"] {
    opacity: var(--dim-disabled);
    cursor: default;
    pointer-events: none;
  }
</style>

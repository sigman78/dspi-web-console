<script lang="ts">
  // Two-step arm/confirm mechanics shared by every "dangerous or persisting
  // action" button (DevicePanel factory-reset/firmware, preset/volume save).
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
    disabledReason,
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
    // Reason surfaced only via aria-describedby (below), for readers/keyboard
    // users when `title`-only was the previous, unreliable channel (A4).
    disabledReason?: string;
  } = $props();

  const uid = $props.id();
  const reasonId = uid + '-reason';

  let armed = $state(false);

  // Native `disabled` removes the button from the a11y/keyboard tree, which
  // is exactly what made the disabled reason unreachable before (A4). Use
  // aria-disabled instead and gate the handlers by hand, so the button stays
  // focusable and its description reads.
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
  aria-describedby={disabled && disabledReason ? reasonId : undefined}
  {title}
>{armed ? confirmLabel : label}</button>
{#if disabled && disabledReason}
  <span id={reasonId} class="sr-only">{disabledReason}</span>
{/if}

<style>
  .chip[aria-disabled="true"] {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>

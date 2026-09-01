<script lang="ts">
  import type { PinPickerCell } from '@/domain';
  import { Wire } from '@/protocol';
  import PinCell from './PinCell.svelte';

  const { value, cells, disabled = false, placeholder, ariaLabel, onChange }: {
    value: number;
    cells: PinPickerCell[];
    disabled?: boolean;
    placeholder?: string;
    ariaLabel: string;
    onChange: (pin: number) => void;
  } = $props();

  const uid = $props.id();
  const popoverId = `pinpicker-${uid}`;
  // Anchor-positioning custom-idents must be dashed-idents.
  const anchorName = `--pinpicker-anchor-${uid}`;

  let popEl: HTMLDivElement | undefined = $state();
  let expanded = $state(false);

  // A device-pushed change can disable the trigger while the popup is open
  // (e.g. a remote PDM enable) -- close it so the gate actually blocks edits.
  $effect(() => {
    if (disabled) popEl?.hidePopover?.();
  });

  // A staged reset (panel DEFAULTS chips stage the 0xFF wire sentinel) flows
  // back as `value` until the device reports the resolved pin.
  const label = $derived(
    value === Wire.Const.PIN_RESET_TO_DEFAULT ? 'DEFAULT'
    : placeholder && value === 0 ? placeholder
    : `GP${value}`,
  );

  function titleFor(cell: PinPickerCell): string {
    if (cell.use) return `GP${cell.pin} · ${cell.use.label}`;
    if (cell.reserved) return `GP${cell.pin} · reserved`;
    if (cell.reason) return `GP${cell.pin} · ${cell.reason}`;
    return `GP${cell.pin} · free${cell.adc ? ' · ADC' : ''}`;
  }

  function select(pin: number): void {
    onChange(pin);
    popEl?.hidePopover?.();
  }

  function onToggle(e: ToggleEvent): void {
    expanded = e.newState === 'open';
  }

  // Roving focus over the rendered buttons, in cell (GPIO) order -- ±1 for a
  // row step, ±8 for a column step (the grid is 8 wide). Disabled cells are
  // skipped, not landed on.
  function onGridKeydown(e: KeyboardEvent): void {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[e.key];
    if (delta == null) return;
    const buttons = Array.from((e.currentTarget as HTMLElement).querySelectorAll('button.cell'));
    const from = buttons.indexOf(document.activeElement as Element);
    if (from === -1) return;
    e.preventDefault();
    for (let i = from + delta; i >= 0 && i < buttons.length; i += delta) {
      const btn = buttons[i] as HTMLButtonElement;
      if (!btn.disabled) { btn.focus(); return; }
    }
  }
</script>

<button
  type="button"
  class="trigger"
  class:open={expanded}
  popovertarget={popoverId}
  popovertargetaction="toggle"
  style="anchor-name: {anchorName};"
  aria-label={ariaLabel}
  aria-haspopup="listbox"
  aria-expanded={expanded}
  {disabled}
>{label}</button>

<div
  bind:this={popEl}
  id={popoverId}
  popover="auto"
  role="listbox"
  tabindex="-1"
  aria-label={ariaLabel}
  class="popup"
  style="position-anchor: {anchorName};"
  ontoggle={onToggle}
  onkeydown={onGridKeydown}
>
  <div class="grid">
    {#each cells as cell (cell.pin)}
      <PinCell
        pin={cell.pin}
        use={cell.use}
        reserved={cell.reserved}
        adc={cell.adc}
        selected={cell.pin === value}
        selectable={cell.selectable}
        interactive
        title={titleFor(cell)}
        onSelect={() => select(cell.pin)}
      />
    {/each}
  </div>
</div>

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    /* Fixed width so GPn / GPnn / UNSET / DEFAULT all line up; the chevron
       stays pinned to the right edge, the label to the left. */
    width: 70px;
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 7px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .trigger:hover:not(:disabled) { border-color: var(--border-hi); }
  .trigger:disabled { opacity: var(--dim-disabled); cursor: default; }
  /* Editability cue: the dropdown chevron marks the value as assignable; a
     disabled picker (e.g. the UART RX / I2C SCL followers) reads as a plain
     value. Pseudo-element so it stays out of textContent and the aria name. */
  .trigger::after {
    content: '▾';
    font-size: 11px;
    line-height: 1;
    color: var(--text-faint);
  }
  .trigger:hover:not(:disabled)::after { color: var(--text); }
  .trigger:disabled::after { content: none; }
  /* While the popup is open: the trigger is the thing being edited. */
  .trigger.open {
    border-color: var(--accent);
    color: var(--text);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  .trigger.open::after { content: '▴'; color: var(--accent); }

  .popup {
    position-area: block-end span-inline-end;
    position-try-fallbacks: flip-block, flip-inline;
    margin: 4px 0 0;
    width: 272px;
    padding: 8px;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-s);
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--accent) 22%, transparent),
      0 10px 30px oklch(0% 0 0 / 0.55),
      0 2px 8px oklch(0% 0 0 / 0.35);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 3px;
  }
</style>

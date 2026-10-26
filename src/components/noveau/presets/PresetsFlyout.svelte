<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { boundary, presetsDirty } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import { saveActivePresetNamed } from '@/components/presets/saveActivePresetNamed';
  import * as Runtime from '@/runtime';
  import { PresetStartupMode } from '@/protocol';
  import { PRESET_NAME_MAX_LEN, PRESET_SLOT_COUNT, type PresetSlot } from '@/domain';
  import { noveauUi } from '../noveauUi.svelte';
  import PresetIcon from './PresetIcon.svelte';
  import { slotRows } from './slotRows';
  import { rowActions, type RowActionId } from './rowActions';

  const s = getSession();
  const slots = Array.from({ length: PRESET_SLOT_COUNT }, (_, i) => i as PresetSlot);

  const dir = $derived(s.presets.directory);
  const held = $derived(s.copySource.held);
  const busy = $derived(s.presets.busy);
  const startupMode = $derived(dir?.startupMode ?? PresetStartupMode.Specified);
  const rows = $derived(slotRows({
    slots,
    names: s.presets.names,
    occupied: dir?.occupiedSlotsSet ?? null,
    active: s.presets.active,
    startup: dir != null && dir.startupMode === PresetStartupMode.Specified ? dir.defaultSlot : null,
    dirty: presetsDirty(s),
    copiedSlot: held?.slot ?? null,
  }));

  let localError = $state<string | null>(null);
  const errorText = $derived(localError ?? s.presets.lastActionError);
  const fetchError = $derived(s.presets.lastFetchError);

  let root: HTMLElement | undefined = $state();
  let fileEl: HTMLInputElement | undefined = $state();
  let importTarget: PresetSlot | null = null;

  function close(): void {
    noveauUi.presetsOpen = false;
  }
  function dismissError(): void {
    localError = null;
    Runtime.dismissPresetActionError(s);
  }

  onMount(() => {
    if (s.presets.directory == null && !s.presets.busy) void Runtime.fetchPresetInfo(s);
  });
  let focused = false;
  $effect(() => {
    if (dir == null || focused) return;
    focused = true;
    void tick().then(() => root?.querySelector<HTMLElement>('.nm')?.focus());
  });
  onDestroy(() => {
    document.querySelector<HTMLElement>('[data-presets-toggle]')?.focus();
  });

  function onWindowKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented || boundary.pending != null) return;
    close();
  }
  function onWindowPointerDown(e: PointerEvent): void {
    if (boundary.pending != null) return;
    if ((e.target as Element | null)?.closest('.rhead')) return;
    const edit = root?.querySelector<HTMLInputElement>('.nm-edit');
    if (edit) finishEdit(edit, true);
    close();
  }

  // A paste into another slot first activates it through the normal LOAD
  // path, which carries the unsaved-changes prompt.
  async function pasteInto(target: PresetSlot, state: Parameters<typeof Runtime.pastePresetTo>[1]): Promise<boolean> {
    if (s.presets.busy) return false;
    if (target !== s.presets.active) {
      await Runtime.loadPresetSlot(s, target);
      if (s.presets.active !== target) return false;
    }
    const r = await Runtime.pastePresetTo(s, state);
    return r.ok;
  }

  async function onSetStartup(slot: PresetSlot): Promise<void> {
    if (s.presets.busy) return;
    if (startupMode !== PresetStartupMode.Specified) await Runtime.setStartupMode(s, PresetStartupMode.Specified);
    await Runtime.setStartupDefault(s, slot);
  }

  function onExport(): void {
    const out = Runtime.exportHeldPreset(s);
    if (out == null) return;
    localError = null;
    const url = URL.createObjectURL(new Blob([out.text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = out.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function onFile(e: Event): Promise<void> {
    const target = importTarget;
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || target == null) return;
    localError = null;
    Runtime.dismissPresetActionError(s);
    const decoded = Runtime.decodeImportedPreset(s, await file.text());
    if (!decoded.ok) { localError = decoded.reason; return; }
    const pasted = await pasteInto(target, decoded.state);
    if (!pasted && s.presets.lastActionError == null) localError = 'Import did not apply';
    const name = decoded.name.trim();
    if (pasted && name.length > 0 && name !== (s.presets.names[target] ?? '')) {
      await Runtime.renamePresetSlot(s, target, name);
    }
  }

  async function run(id: RowActionId, slot: PresetSlot): Promise<void> {
    if (s.presets.busy) return;
    switch (id) {
      case 'save': await saveActivePresetNamed(s); break;
      case 'revert': await Runtime.revertActivePreset(s); break;
      case 'copy': await Runtime.copyActivePreset(s); break;
      case 'paste': if (held != null) await pasteInto(slot, held.blob); break;
      case 'load': await Runtime.loadPresetSlot(s, slot); break;
      case 'drop': s.copySource.held = null; break;
      case 'export': onExport(); break;
      case 'import': importTarget = slot; fileEl?.click(); break;
      case 'delete': await Runtime.deletePresetSlot(s, slot); break;
    }
  }

  let editSlot = $state<PresetSlot | null>(null);
  let editBase = '';
  // Each edit ends with exactly one terminal action; Enter and Escape unmount
  // the input, whose trailing blur would otherwise fire a second one.
  let finished = false;

  function startEdit(slot: PresetSlot): void {
    if (s.presets.busy) return;
    window.getSelection()?.removeAllRanges();
    editBase = s.presets.names[slot] ?? '';
    editSlot = slot;
  }
  function initInput(node: HTMLInputElement): void {
    finished = false;
    node.value = editBase;
    node.focus();
    node.select();
  }
  function finishEdit(node: HTMLInputElement, commit: boolean): void {
    if (finished) return;
    finished = true;
    const slot = editSlot;
    editSlot = null;
    const next = node.value.trim();
    if (commit && slot != null && next.length > 0 && next !== editBase) void Runtime.renamePresetSlot(s, slot, next);
  }
  function onInputKey(e: KeyboardEvent, slot: PresetSlot): void {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finishEdit(e.currentTarget as HTMLInputElement, e.key === 'Enter');
    void tick().then(() => root?.querySelector<HTMLElement>(`.nm[data-slot="${slot}"]`)?.focus());
  }
  function onNameKey(e: KeyboardEvent, slot: PresetSlot): void {
    if (e.key === 'F2' || e.key === 'Enter') {
      e.preventDefault();
      startEdit(slot);
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerDown} />

<div class="fly" role="dialog" aria-modal="false" aria-label="Presets" data-budget bind:this={root}>
  <header>
    <span class="title">PRESETS</span>
    <button type="button" class="x" aria-label="Close presets" onclick={close}>×</button>
  </header>

  {#if dir == null}
    <div class="state">
      {#if fetchError}
        <span class="bad">{fetchError}</span>
        <button type="button" class="chip" onclick={() => void Runtime.retryFetchPresetInfo(s)}>RETRY</button>
      {:else}
        <span>Loading presets…</span>
      {/if}
    </div>
  {:else}
    <div class="list">
      {#each rows as r (r.slot)}
        {@const empty = !r.occupied && !r.active}
        <div class="row" class:act={r.active} class:empty>
          <button
            type="button"
            class="ix"
            class:startup={r.startup}
            disabled={busy || r.startup || empty}
            aria-label={r.startup ? `Slot ${r.slot}, startup preset` : `Use slot ${r.slot} as startup preset`}
            title={r.startup ? 'Startup preset' : 'Set as startup preset'}
            onclick={() => void onSetStartup(r.slot)}
          >{r.slot}</button>
          <div class="nmcell">
            {#if editSlot === r.slot}
              <input
                class="nm-edit"
                type="text"
                maxlength={PRESET_NAME_MAX_LEN}
                aria-label="Preset name"
                use:initInput
                onkeydown={(e) => onInputKey(e, r.slot)}
                onblur={(e) => finishEdit(e.currentTarget, true)}
              />
            {:else}
              <span
                class="nm"
                class:unnamed={r.name.length === 0}
                class:dirty={r.dirty}
                role="button"
                tabindex="0"
                data-slot={r.slot}
                aria-keyshortcuts="F2"
                title="Double-click or F2 to rename"
                ondblclick={() => startEdit(r.slot)}
                onkeydown={(e) => onNameKey(e, r.slot)}
              >{r.name.length ? r.name : r.occupied || r.active ? '[unnamed]' : 'empty'}</span>
              {#if r.copied}<span class="pill">COPIED</span>{/if}
            {/if}
          </div>
          <div class="acts">
            {#each rowActions({ row: r, held }) as a (a.id)}
              {#if a.id === 'delete'}
                <ConfirmButton
                  label={a.label}
                  confirmLabel="CONFIRM"
                  tone="danger"
                  extraClass="q"
                  ariaLabel={`Delete slot ${r.slot}`}
                  title="Erase this slot from the device"
                  onConfirm={() => void run(a.id, r.slot)}
                />
              {:else if a.icon}
                {@const text = a.icon === 'save' ? 'Save preset' : 'Revert preset'}
                <button
                  type="button"
                  class="icon-toggle"
                  class:accent={a.tone === 'accent'}
                  aria-label={text}
                  title={text}
                  onclick={() => void run(a.id, r.slot)}
                ><PresetIcon icon={a.icon} /></button>
              {:else}
                <button
                  type="button"
                  class="chip"
                  class:q={a.quiet}
                  class:accent={a.tone === 'accent'}
                  onclick={() => void run(a.id, r.slot)}
                >{a.label}</button>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if errorText}
    <div class="err" role="alert">
      <span>{errorText}</span>
      <button type="button" onclick={dismissError} aria-label="Dismiss">×</button>
    </div>
  {/if}
  <input bind:this={fileEl} type="file" accept=".json,application/json" hidden onchange={onFile} />
</div>

<style>
  .fly {
    position: absolute;
    left: calc(100% + 6px);
    top: 0;
    z-index: 30;
    width: 400px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-m);
    box-shadow: 0 12px 32px oklch(0% 0 0 / 0.5);
  }
  header {
    flex: none;
    height: 28px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid var(--border);
  }
  .title { font-family: var(--font-sans); font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }
  .x {
    margin-left: auto;
    width: 20px;
    height: 20px;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--radius-s);
    color: var(--text-dim);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .x:hover { color: var(--text); background: var(--wash); }
  .state {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 12px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .state .bad { color: var(--err); }
  .state .chip {
    height: 20px;
    padding: 0 8px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
  }
  .list { display: flex; flex-direction: column; }
  .row {
    height: 28px;
    flex: none;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 8px;
    padding: 0 8px 0 6px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-dim);
  }
  .row:last-child { border-bottom: none; }
  .row.act { background: color-mix(in oklab, var(--accent) 14%, transparent); color: var(--text); }
  .ix {
    width: 24px;
    height: 20px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    background: var(--wash-strong);
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .row.empty .ix { background: none; border: 1px dashed var(--border-hi); color: var(--text-faint); }
  .ix:hover:not(:disabled) { color: var(--text); border-color: var(--warn); }
  .ix:disabled { cursor: default; }
  .ix.startup {
    border: 1px solid var(--warn);
    box-shadow: 0 0 6px color-mix(in oklab, var(--warn) 55%, transparent);
    color: var(--text);
  }
  .nmcell { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    cursor: default;
  }
  .nm.unnamed { color: var(--text-dim); font-weight: 400; }
  .row.empty .nm { color: var(--text-faint); font-weight: 400; font-style: italic; }
  .nm.dirty {
    text-decoration: underline;
    text-decoration-color: var(--warn);
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
  }
  .nm-edit {
    flex: 1;
    min-width: 0;
    height: 22px;
    box-sizing: border-box;
    padding: 0 4px;
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: var(--radius-s);
  }
  .pill {
    flex: none;
    height: 16px;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    border: 1px dashed var(--accent);
    border-radius: var(--radius-s);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: var(--accent);
  }
  .acts { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
  .acts :global(.chip) {
    height: 20px;
    box-sizing: border-box;
    padding: 0 8px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
    line-height: 1;
    white-space: nowrap;
  }
  .acts .icon-toggle { flex: none; width: 20px; height: 20px; }
  .acts .icon-toggle.accent { color: var(--accent); }
  .acts :global(.q) { visibility: hidden; }
  .row:hover .acts :global(.q),
  .row:focus-within .acts :global(.q) { visibility: visible; }
  .err {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 24px;
    box-sizing: border-box;
    padding: 2px 8px 2px 12px;
    border-top: 1px solid color-mix(in oklab, var(--err) 45%, var(--border));
    background: color-mix(in oklab, var(--err) 14%, transparent);
    font-size: 11px;
    color: var(--err);
  }
  .err button { background: none; border: none; color: var(--err); cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
</style>

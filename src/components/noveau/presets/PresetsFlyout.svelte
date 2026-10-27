<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { boundary, confirmState, askConfirm, presetsDirty } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import { saveActivePresetNamed } from '@/components/presets/saveActivePresetNamed';
  import * as Runtime from '@/runtime';
  import { PresetStartupMode } from '@/protocol';
  import { PRESET_NAME_MAX_LEN, type PresetSlot } from '@/domain';
  import { noveauUi } from '../noveauUi.svelte';
  import NameField from '@/components/chrome/NameField.svelte';
  import { dismiss } from '@/components/chrome/dismiss';
  import PresetIcon from './PresetIcon.svelte';
  import PresetOptionsRows from './PresetOptionsRows.svelte';
  import { editorActions, replaceNeedsConfirm, type EditorActionId } from './editorActions';

  const s = getSession();

  const dir = $derived(s.presets.directory);
  const active = $derived(s.presets.active);
  const held = $derived(s.copySource.held);
  const busy = $derived(s.presets.busy);
  const occupied = $derived(active != null && (dir?.occupiedSlotsSet.has(active) ?? false));
  const dirty = $derived(presetsDirty(s));
  const savedName = $derived(active != null ? (s.presets.names[active] ?? '') : '');
  const actions = $derived(
    active == null ? [] : editorActions({ active, occupied, dirty, held }),
  );

  type StartupChoice = 'last' | 'this' | 'other';
  const startupChoice = $derived<StartupChoice>(
    dir == null || dir.startupMode === PresetStartupMode.LastActive ? 'last'
      : dir.defaultSlot === active ? 'this' : 'other',
  );
  const startupElsewhere = $derived(
    dir != null && dir.startupMode === PresetStartupMode.Specified && dir.defaultSlot !== active
      ? dir.defaultSlot : null,
  );

  const others = $derived(
    dir == null ? [] : [...dir.occupiedSlotsSet].filter((n) => n !== active).sort((a, b) => a - b),
  );
  let deleteTarget = $state<PresetSlot | null>(null);
  const deleteSlot = $derived(
    deleteTarget != null && others.includes(deleteTarget) ? deleteTarget : (others[0] ?? null),
  );
  async function onDelete(slot: PresetSlot): Promise<void> {
    const ok = await askConfirm({
      title: `Delete preset ${slot}`,
      body: `Erases ${slotLabel(slot)} from the device. This cannot be undone.`,
      confirmLabel: 'DELETE',
      tone: 'danger',
    });
    if (ok) await Runtime.deletePresetSlot(s, slot);
  }
  function slotLabel(n: PresetSlot): string {
    const name = s.presets.names[n] ?? '';
    return name.length ? `${n} · ${name}` : `${n}`;
  }

  let localError = $state<string | null>(null);
  const errorText = $derived(localError ?? s.presets.lastActionError);

  let fileEl: HTMLInputElement | undefined = $state();

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
    if (active == null || focused) return;
    focused = true;
    void tick().then(() => nameField?.focus());
  });
  onDestroy(() => {
    document.querySelector<HTMLElement>('[data-presets-toggle]')?.focus();
  });

  // Name edits ride the field's own commit; Save flushes a pending one first.
  let nameField: NameField | undefined = $state();
  async function commitName(next: string): Promise<void> {
    const slot = active;
    if (slot != null && next !== savedName) await Runtime.renamePresetSlot(s, slot, next);
  }

  function onDismiss(): void {
    if (boundary.pending == null && confirmState.pending == null) close();
  }

  async function onStartup(choice: StartupChoice): Promise<void> {
    if (busy || active == null) return;
    if (choice === 'last') {
      await Runtime.setStartupMode(s, PresetStartupMode.LastActive);
    } else if (choice === 'this') {
      await Runtime.setStartupDefault(s, active);
    }
  }

  function download(out: { filename: string; text: string }): void {
    const url = URL.createObjectURL(new Blob([out.text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = out.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function confirmReplace(verb: string): Promise<boolean> {
    if (active == null || !replaceNeedsConfirm(occupied, dirty)) return Promise.resolve(true);
    return askConfirm({
      title: `${verb} over preset ${active}`,
      body: `Preset ${active} already holds a saved preset. ${verb} replaces it on the device and saves it.`,
      confirmLabel: verb.toUpperCase(),
      tone: 'warn',
    });
  }

  async function onFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    localError = null;
    Runtime.dismissPresetActionError(s);
    const decoded = Runtime.decodeImportedPreset(s, await file.text());
    if (!decoded.ok) { localError = decoded.reason; return; }
    if (!(await confirmReplace('Import'))) return;
    const slot = active;
    const r = await Runtime.pastePresetTo(s, decoded.state);
    if (!r.ok) {
      if (s.presets.lastActionError == null) localError = 'Import did not apply';
      return;
    }
    const name = decoded.name.trim();
    if (slot != null && name.length > 0 && name !== (s.presets.names[slot] ?? '')) {
      await Runtime.renamePresetSlot(s, slot, name);
    }
  }

  async function run(id: EditorActionId): Promise<void> {
    if (active == null) return;
    if (id === 'save') await nameField?.commit();
    if (s.presets.busy) return;
    switch (id) {
      case 'save': await saveActivePresetNamed(s); break;
      case 'revert': await Runtime.revertActivePreset(s); break;
      case 'copy': await Runtime.copyActivePreset(s); break;
      case 'paste':
        if (held != null && await confirmReplace('Paste')) await Runtime.pastePresetTo(s, held.blob);
        break;
      case 'export': {
        localError = null;
        const slot = active;
        try {
          const blob = await s.queue.run(() => s.device.captureState());
          download(Runtime.presetExportFile(s, s.presets.names[slot] ?? '', slot, blob));
        } catch (e) {
          localError = e instanceof Error ? e.message : 'Export failed';
        }
        break;
      }
      case 'import': fileEl?.click(); break;
    }
  }
</script>

<div class="fly" role="dialog" aria-modal="false" aria-label="Presets" data-budget use:dismiss={{ onDismiss, ignore: '.rhead' }}>
  <header>
    <span class="title">{active != null ? `PRESET ${active}` : 'PRESETS'}</span>
    <button type="button" class="x-btn close" aria-label="Close presets" onclick={close}>✕</button>
  </header>

  {#if dir == null}
    <div class="state">
      {#if s.presets.lastFetchError}
        <span class="bad">{s.presets.lastFetchError}</span>
        <button type="button" class="chip" onclick={() => void Runtime.retryFetchPresetInfo(s)}>RETRY</button>
      {:else}
        <span>Loading presets…</span>
      {/if}
    </div>
  {:else if active == null}
    <div class="state">No active preset</div>
  {:else}
    <div class="body">
      <div class="row">
        <span class="t-label lbl">NAME</span>
        <NameField
          class="name"
          bind:this={nameField}
          value={savedName}
          maxlength={PRESET_NAME_MAX_LEN}
          ariaLabel="Preset name"
          placeholder="[unnamed]"
          disabled={busy}
          onCommit={commitName}
        />
      </div>

      <div class="row">
        <span class="t-label lbl">STARTUP</span>
        <SegmentedSelect
          ariaLabel="Startup preset"
          value={startupChoice}
          disabled={busy || dir == null}
          options={[{ value: 'last', label: 'LAST USED' }, { value: 'this', label: 'THIS PRESET', disabled: !occupied }]}
          onChange={(v) => void onStartup(v)}
        />
        {#if startupElsewhere != null}<span class="hint">startup: preset {startupElsewhere}</span>{/if}
      </div>

      <div class="row">
        <span class="t-label lbl"></span>
        <div class="chips">
          {#each actions as id (id)}
            {#if id === 'save' || id === 'revert'}
              {@const text = id === 'save' ? 'Save preset' : 'Revert preset'}
              <button
                type="button"
                class="icon-toggle"
                class:accent={id === 'save'}
                aria-label={text}
                title={text}
                disabled={busy || boundary.pending != null}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => void run(id)}
              ><PresetIcon icon={id} /></button>
            {:else}
              <button
                type="button"
                class="chip"
                disabled={busy || boundary.pending != null}
                title={id === 'import' ? 'Import a JSON preset into this slot (replaces and saves it)' : undefined}
                onclick={() => void run(id)}
              >
                {id === 'export' ? 'EXPORT JSON' : id === 'import' ? 'IMPORT JSON' : id.toUpperCase()}
              </button>
            {/if}
          {/each}
        </div>
      </div>

      <div class="row top">
        <span class="t-label lbl">OPTIONS</span>
        <div class="opts"><PresetOptionsRows /></div>
      </div>

      {#if others.length > 0 && deleteSlot != null}
        <div class="row">
          <span class="t-label lbl">MANAGE</span>
          <span class="dim">Delete slot</span>
          <select
            class="sel"
            aria-label="Slot to delete"
            disabled={busy}
            value={deleteSlot}
            onchange={(e) => { deleteTarget = Number(e.currentTarget.value) as PresetSlot; }}
          >
            {#each others as n (n)}<option value={n}>{slotLabel(n)}</option>{/each}
          </select>
          <button
            type="button"
            class="chip danger"
            disabled={busy}
            aria-label={`Delete slot ${deleteSlot}`}
            title="Erase this slot from the device"
            onclick={() => void onDelete(deleteSlot)}
          >DELETE</button>
        </div>
      {/if}
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
    z-index: var(--z-flyout);
    width: 400px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-m);
    box-shadow: var(--shadow-flyout);
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
  .x-btn { margin-left: auto; }
  .state {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 12px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .body { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    font-size: 11px;
  }
  .row.top { align-items: flex-start; }
  .row.top .lbl { line-height: 24px; }
  .lbl { flex: none; width: 72px; }
  .state .bad { color: var(--err); }
  .dim { color: var(--text-dim); }
  .hint { color: var(--text-faint); }
  .row :global(.name) {
    flex: 1;
    min-width: 0;
    height: 24px;
    box-sizing: border-box;
    padding: 0 6px;
    font: inherit;
    font-size: 12px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-s);
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips .chip { gap: 4px; line-height: 1; white-space: nowrap; }
  .opts { flex: 1; min-width: 0; }
  .sel {
    height: 24px;
    max-width: 130px;
    font: inherit;
    font-size: 11px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border-hi);
    border-radius: var(--radius-s);
  }
  .err {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 24px;
    box-sizing: border-box;
    padding: 2px 8px 2px 12px;
    border-top: 1px solid color-mix(in oklab, var(--err) 45%, var(--border));
    background: color-mix(in oklab, var(--err) var(--tint), transparent);
    font-size: 11px;
    color: var(--err);
  }
  .err button { background: none; border: none; color: var(--err); cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
</style>

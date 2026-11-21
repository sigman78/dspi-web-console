<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import NameField from '@/components/chrome/NameField.svelte';
  import * as Runtime from '@/runtime';
  import * as Domain from '@/domain';
  import { connection } from '@/state';
  import { formatRateKHz } from '@/utils';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const info = $derived(s.telemetry.info);

  let renaming = $state(false);
  let nameBtn = $state<HTMLButtonElement>();
  // Only a keyboard exit (Enter/Escape) returns focus to the value; a click-away keeps it where the user clicked.
  let restoreFocus = false;

  $effect(() => {
    if (!renaming && restoreFocus) {
      nameBtn?.focus();
      restoreFocus = false;
    }
  });

  function startRename(): void {
    window.getSelection()?.removeAllRanges();
    renaming = true;
  }

  function onNameKey(e: KeyboardEvent): void {
    if (e.key === 'F2' || e.key === 'Enter') {
      e.preventDefault();
      startRename();
    }
  }

  async function commitName(name: string): Promise<void> {
    renaming = false;
    if (name !== s.names.device) await Runtime.setDeviceName(s, name);
  }
</script>

<Panel title="DEVICE">
  <div class="kvrows">
    <KV inline label="STATUS"   value={connection.label} tone={connection.connected ? 'ok' : 'off'} />
    {#if s.names.deviceSupported === true}
      <KV inline label="NAME" value={s.names.device || '—'}>
        {#if renaming}
          <NameField
            class="name-input"
            editing
            allowEmpty
            value={s.names.device}
            maxlength={Domain.DEVICE_NAME_MAX_LEN}
            placeholder="Unnamed"
            ariaLabel="Device name"
            onCommit={commitName}
            onCancel={() => { renaming = false; }}
            onKeyExit={() => { restoreFocus = true; }}
          />
        {:else}
          <button type="button" class="name-btn" bind:this={nameBtn} title="Double-click or F2 to rename"
            aria-label={`Device name: ${s.names.device || 'unnamed'}. Double-click or F2 to rename`}
            ondblclick={startRename} onkeydown={onNameKey}>{s.names.device || '—'}</button>
        {/if}
      </KV>
    {:else}
      <KV inline label="NAME"     value={s.names.device || '—'} />
    {/if}
    <KV inline label="SERIAL"   value={s.info.serial} />
    <KV inline label="PLATFORM" value={snap?.platform.name ?? '—'} />
    <KV inline label="OUTPUTS"  value={`${snap?.platform.outputCount ?? 0} / ${snap?.platform.totalChannelCount ?? 0}`} />
    <KV inline label="CLOCK"    value={info?.clockHz != null ? `${(info.clockHz / 1_000_000).toFixed(0)} MHz` : '—'} />
    <KV inline label="SAMPLE"   value={info?.sampleRateHz != null ? formatRateKHz(info.sampleRateHz) : '—'} />
    <KV inline label="VOLTAGE"  value={info?.coreVoltageMv != null ? `${(info.coreVoltageMv / 1000).toFixed(3)} V` : '—'} />
  </div>
</Panel>

<style>
  .name-btn {
    all: unset;
    font: inherit;
    color: inherit;
    text-align: right;
    overflow-wrap: anywhere;
    cursor: text;
  }
  .name-btn:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-xs); }
  .kvrows :global(.name-input) {
    box-sizing: border-box;
    width: 15em;
    max-width: 100%;
    height: 20px;
    padding: 0 6px;
    font: inherit;
    text-align: right;
    color: var(--text);
    background: var(--bg);
    border: none;
    border-radius: var(--radius-s);
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent);
  }
</style>

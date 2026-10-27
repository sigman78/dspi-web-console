<script lang="ts">
  import * as State from '@/state';
  import ChannelRow from './ChannelRow.svelte';
  import { setChannelName } from '@/runtime';
  import { chKey } from '@/styles/palette';
  import { groupIntoPairs, groupInputSlotPairs, inputIndexOf, type ChannelGroup, type ChannelId, type ChannelModel } from '@/domain';

  const snap = $derived(State.activeSession()?.mirror.current ?? null);
  const tele = $derived(State.activeSession()?.telemetry ?? null);
  const disabled = $derived(!State.connection.connected);

  // Inline rename: one row editable at a time. The row component owns the
  // pending text and its own commit-once guard; the list tracks which row is
  // open and routes the committed value through setChannelName.
  let editingId = $state<ChannelId | null>(null);
  let originalValue = '';

  function startEdit(ch: ChannelModel): void {
    if (!State.connection.connected) return;
    editingId = ch.id;
    originalValue = ch.name;
  }

  function commitName(id: ChannelId, value: string): void {
    if (editingId !== id) return; // re-entry guard (defense in depth)
    editingId = null;
    const s = State.activeSession();
    if (!s) return; // disconnected mid-edit: no-op rather than throw
    if (value !== originalValue) setChannelName(s, id, value);
  }

  function cancelEdit(): void {
    editingId = null;
  }

  // Only the LIVE input channels (USB alt / I2S count, V16); null = all.
  const activeInputs = $derived(tele?.activeInputChannels ?? null);
  const inputGroups = $derived(groupInputSlotPairs(
    snap?.channels.filter((c) => {
      if (c.isOutput) return false;
      if (activeInputs == null) return true;
      const slot = inputIndexOf(c.id);
      return slot !== null && slot < Math.max(2, activeInputs);
    }) ?? [],
  ));
  const outputGroups = $derived(groupIntoPairs(
    snap?.channels.filter((c) => c.isOutput) ?? [],
  ));

  function levelDb(ch: ChannelModel): number {
    const p = tele?.peaks[ch.id] ?? 0;
    return p > 0 ? 20 * Math.log10(p) : -60;
  }

  function isDisabledOutput(ch: ChannelModel): boolean {
    if (!snap || !ch.isOutput) return false;
    const out = snap.outputs.find((o) => o.id === ch.id);
    return !out || !out.enabled;
  }
</script>

<div class="rail-body" class:is-disabled={disabled}>
  {#snippet section(label: string, groups: ChannelGroup<ChannelModel>[])}
    {#if groups.length}
      <div class="microlbl">{label}</div>
      {#each groups as g (g.accentId)}
        <div class="pair ch-{chKey(g.accentId)}">
          <span class="spine"></span>
          <div class="stack">
            {#each g.members as ch (ch.id)}
              {#if isDisabledOutput(ch)}
                <button
                  type="button"
                  class="stub"
                  class:selected={State.settings.selectedChannel === ch.id}
                  {disabled}
                  aria-pressed={State.settings.selectedChannel === ch.id}
                  title={ch.name}
                  onclick={() => State.selectChannel(ch.id)}
                ><span class="nm">{ch.name}</span></button>
              {:else}
                <ChannelRow
                  name={ch.name}
                  channelId={ch.id}
                  levelDb={levelDb(ch)}
                  defaultName={ch.defaultName}
                  selected={State.settings.selectedChannel === ch.id}
                  pulsate={State.eqUi.copySource === ch.id}
                  {disabled}
                  editing={editingId === ch.id}
                  onclick={() => State.selectChannel(ch.id)}
                  onStartEdit={() => startEdit(ch)}
                  onCommitName={(value) => commitName(ch.id, value)}
                  onCancelEdit={cancelEdit}
                />
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  {/snippet}

  {@render section('INPUTS', inputGroups)}
  {@render section('OUTPUTS', outputGroups)}
</div>

<style>
  .rail-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 4px 10px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  /* U-P3 policy B: no whole-rail dim when disconnected (names/meters are
     structure, stay full-contrast). pointer-events still blocks interaction;
     each ChannelRow's clickable body carries the single dim layer itself. */
  .rail-body.is-disabled { pointer-events: none; }
  .microlbl { margin-top: 2px; }
  .pair { display: flex; gap: 5px; }
  /* Selected-channel spine: 3px var(--ch-base) bar at 0.85 opacity, 2px
     radius, beside the stacked rows. */
  .spine {
    width: 3px;
    flex: none;
    border-radius: var(--radius-xs);
    background: var(--ch-base);
    opacity: 0.85;
  }
  .stack { flex: 1; display: flex; flex-direction: column; gap: 0; min-width: 0; }

  /* Hardware-disabled output: a flat hatched 24px row, still selectable. */
  .stub {
    height: 24px;
    flex: none;
    display: flex;
    align-items: center;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: var(--radius-s);
    color: var(--text-faint);
    font-family: var(--font-sans);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    background: repeating-linear-gradient(
      135deg,
      var(--wash-strong) 0 3px,
      transparent 3px 7px
    );
  }
  .stub:hover:not(:disabled) { border-color: var(--border-hi); }
  .stub.selected { border-color: var(--ch-base); }
  .stub:disabled { opacity: var(--dim-disabled); cursor: default; }
  .stub .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>

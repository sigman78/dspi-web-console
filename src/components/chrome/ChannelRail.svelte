<script lang="ts">
  import * as appState from '@/state';
  import ChannelRow from './ChannelRow.svelte';
  import PresetActiveChip from '@/components/presets/PresetActiveChip.svelte';
  import { setChannelName } from '@/runtime';
  import { chKey } from '@/styles/palette';
  import { groupIntoPairs, type ChannelGroup, type ChannelId, type ChannelModel } from '@/domain';

  const snap = $derived(appState.activeSession()?.mirror.current ?? null);
  const tele = $derived(appState.activeSession()?.telemetry ?? null);
  const disabled = $derived(!appState.connection.connected);

  // Inline rename: one row editable at a time. The row component owns the
  // pending text and its own commit-once guard; the rail tracks which row is
  // open and routes the committed value through setChannelName.
  let editingId = $state<ChannelId | null>(null);
  let originalValue = '';

  function startEdit(ch: ChannelModel): void {
    if (!appState.connection.connected) return;
    editingId = ch.id;
    originalValue = ch.name;
  }

  function commitName(id: ChannelId, value: string): void {
    if (editingId !== id) return; // re-entry guard (defense in depth)
    editingId = null;
    const s = appState.activeSession();
    if (!s) return; // disconnected mid-edit: no-op rather than throw
    if (value !== originalValue) setChannelName(s, id, value);
  }

  function cancelEdit(): void {
    editingId = null;
  }

  const inputGroups = $derived(groupIntoPairs(snap?.channels.filter((c) => !c.isOutput) ?? []));
  const outputGroups = $derived(groupIntoPairs(snap?.channels.filter((c) => c.isOutput) ?? []));

  function levelDb(ch: ChannelModel): number {
    const p = tele?.peaks[ch.id] ?? 0;
    return p > 0 ? 20 * Math.log10(p) : -60;
  }

  function isDim(ch: ChannelModel): boolean {
    if (!snap) return true;
    if (!ch.isOutput) return false;
    const out = snap.outputs.find((o) => o.id === ch.id);
    return !out || !out.enabled;
  }
</script>

<div class="rail">
  <div class="rail-head">
    <div class="microlbl">PRESET</div>
    <PresetActiveChip />
  </div>
  <div class="rail-body" class:is-disabled={disabled}>
    {#snippet section(label: string, groups: ChannelGroup<ChannelModel>[])}
      {#if groups.length}
        <div class="microlbl">{label}</div>
        {#each groups as g (g.accentId)}
          <div class="pair ch-{chKey(g.accentId)}">
            <span class="spine"></span>
            <div class="stack">
              {#each g.members as ch (ch.id)}
                <ChannelRow
                  name={ch.name}
                  channelId={ch.id}
                  levelDb={levelDb(ch)}
                  defaultName={ch.defaultName}
                  selected={appState.settings.selectedChannel === ch.id}
                  dim={isDim(ch)}
                  pulsate={appState.eqUi.copySource === ch.id}
                  clipped={tele?.clipLatched[ch.id] ?? false}
                  disabled={disabled}
                  editing={editingId === ch.id}
                  onclick={() => appState.selectChannel(ch.id)}
                  onStartEdit={() => startEdit(ch)}
                  onCommitName={(value) => commitName(ch.id, value)}
                  onCancelEdit={cancelEdit}
                />
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    {/snippet}

    {@render section('INPUTS', inputGroups)}
    {@render section('OUTPUTS', outputGroups)}
  </div>
</div>

<style>
  .rail {
    width: 196px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg) 40%, transparent);
  }
  .rail-head {
    padding: 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rail-head .microlbl { margin-top: 0; }
  .rail-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  /* U-P3 policy B: no whole-rail dim when disconnected (names/meters are
     structure, stay full-contrast). pointer-events still blocks interaction;
     each ChannelRow's clickable body carries the single dim layer itself. */
  .rail-body.is-disabled { pointer-events: none; }
  .microlbl { margin-top: 4px; }
  .pair { display: flex; gap: 6px; }
  /* Selected-channel spine: 3px var(--ch-base) bar at 0.85 opacity, 2px
     radius. Same recipe as MatrixHeader's .header.selected::after (column)
     and MixerTab's .row-head.selected::after (row) — a real element here
     since it sits beside stacked rows rather than overlaying a single one. */
  .spine {
    width: 3px;
    flex: none;
    border-radius: 2px;
    background: var(--ch-base);
    opacity: 0.85;
  }
  .stack { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
</style>

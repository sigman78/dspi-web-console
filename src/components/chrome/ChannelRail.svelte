<script lang="ts">
  import * as state from '@/state';
  import ChannelRow from './ChannelRow.svelte';
  import { chKey } from '@/styles/palette';
  import { groupIntoPairs, type ChannelGroup, type ChannelModel } from '@/domain';

  const snap = $derived(state.activeSession()?.mirror.current ?? null);
  const tele = $derived(state.activeSession()?.telemetry ?? null);
  const disabled = $derived(!state.connection.connected);

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

<div class="rail" class:is-disabled={disabled}>
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
                selected={state.settings.eqTarget === ch.id}
                dim={isDim(ch)}
                pulsate={state.eqUi.copySource === ch.id}
                clipped={tele?.clipLatched[ch.id] ?? false}
                disabled={disabled || isDim(ch)}
                onclick={() => state.selectChannel(ch.id)}
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

<style>
  .rail {
    width: 196px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 12px 10px;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg) 40%, transparent);
  }
  .rail.is-disabled { opacity: 0.45; pointer-events: none; }
  .microlbl { margin-top: 4px; }
  .pair { display: flex; gap: 6px; }
  .spine {
    width: 3px;
    flex: none;
    border-radius: 2px;
    background: var(--ch-base);
    opacity: 0.85;
  }
  .stack { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
</style>

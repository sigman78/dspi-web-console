<script lang="ts">
  // TARGET (channel or group) and, for band nouns, BAND pickers. Renders
  // label/select pairs for the caller's `.row`; the caller owns what a pick
  // does to its draft.
  import * as Domain from '@/domain';
  import * as CsField from '@/domain/cs/fieldHelpers';
  import * as CsTarget from './csTargetEncoding';

  const { nouns, noun, target, index, grouped, channels, groups, groupsEnabled, disabled = false, ariaSuffix = '', onTarget, onBand }: {
    nouns: readonly Domain.CsNounCaps[];
    noun: number;
    target: number;
    index: number;
    grouped: boolean;
    channels: readonly Domain.ChannelModel[];
    groups: readonly (Domain.CsGroup | null)[];
    groupsEnabled: boolean;
    disabled?: boolean;
    ariaSuffix?: string;
    onTarget: (pick: CsTarget.TargetPick) => void;
    onBand: (band: number) => void;
  } = $props();

  const channelOpts = $derived(CsField.targetOptionsFor(nouns, noun, channels));
  const groupOpts = $derived(groupsEnabled ? CsField.groupOptionsFor(nouns, noun, groups) : []);
  const view = $derived(CsTarget.groupSplit(groupsEnabled, groupOpts, grouped, target));
  const bandOpts = $derived.by(() => {
    if (!grouped) return CsField.bandOptionsFor(noun, target, channels);
    const g = groups[target];
    return g ? CsField.groupBandOptionsFor(nouns, noun, g, channels) : [];
  });
</script>

<span class="pair">
  <span class="microlbl">{CsTarget.targetKindLabel(CsField.targetKindOf(nouns, noun))}</span>
  <select class="sel" value={CsTarget.encodeTarget(grouped, target)} aria-label={`Target channel${ariaSuffix}`} {disabled}
    onchange={(e) => onTarget(CsTarget.decodeTarget((e.currentTarget as HTMLSelectElement).value))}>
    {#if view.split}
      <optgroup label="CHANNELS">
        {#each channelOpts as o (o.v)}
          <option value={String(o.v)}>{o.label}</option>
        {/each}
      </optgroup>
      <optgroup label="GROUPS">
        {#each groupOpts as o (o.v)}
          <option value={CsTarget.encodeTarget(true, o.v)}>{o.label}</option>
        {/each}
        {#if view.missing}
          <option value={CsTarget.encodeTarget(true, target)} disabled>Group {target + 1} (missing)</option>
        {/if}
      </optgroup>
    {:else}
      {#each channelOpts as o (o.v)}
        <option value={String(o.v)}>{o.label}</option>
      {/each}
    {/if}
  </select>
</span>
{#if CsField.showBandOf(nouns, noun)}
  <span class="pair">
    <span class="microlbl">BAND</span>
    <select class="sel" value={String(index)} aria-label={`Filter band${ariaSuffix}`} {disabled}
      onchange={(e) => onBand(Number((e.currentTarget as HTMLSelectElement).value))}>
      {#each bandOpts as o (o.v)}
        <option value={String(o.v)}>{o.label}</option>
      {/each}
    </select>
  </span>
{/if}

<style>
  .pair { display: inline-flex; align-items: center; gap: 8px; }
</style>

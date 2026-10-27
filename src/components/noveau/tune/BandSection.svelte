<script lang="ts">
  import BandTypeSelect from '@/components/noveau/tune/BandTypeSelect.svelte';
  import SliderField from '@/components/chrome/SliderField.svelte';
  import BypassButton from '@/components/noveau/tune/BypassButton.svelte';
  import { Eq, FilterType, TYPE_LABELS, offeredTypes, type ChannelModel, type FilterParams } from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
  import InspectorSection from './InspectorSection.svelte';
  import { bandDraft, bandHold, holdBand } from './bandDraft.svelte';
  import { patchBand } from './bandOps';
  import { bandHasGain, bandHasQ } from '@/domain';

  const { channel }: { channel: ChannelModel } = $props();

  const s = getSession();
  const types = $derived(offeredTypes(s.device.capabilities.features));
  const index = $derived(noveauUi.selectedBand);
  const band = $derived(index !== null ? (channel.filters[index] ?? null) : null);
  const off = $derived(!band || band.type === FilterType.Flat);
  const locked = $derived(!band || off || band.bypass || band.type === FilterType.LinkwitzTransform);
  const gainOn = $derived(!!band && bandHasGain(band.type));
  const qOn = $derived(!!band && bandHasQ(band.type));
  const dash = (on: boolean): string | undefined => (on ? undefined : '—');

  // The band as the graph currently draws it, so a field edit builds on a pending drag or write.
  const shownBand = (i: number): FilterParams => {
    const d = bandDraft.current ?? bandHold.value;
    return d && d.channelId === channel.id && d.kind === 'peq' && d.index === i ? d.band : channel.filters[i];
  };
  function preview(patch: Partial<FilterParams>): void {
    if (index === null) return;
    bandDraft.current = { channelId: channel.id, kind: 'peq', index, band: { ...shownBand(index), ...patch } };
  }
  function commit(patch: Partial<FilterParams>): void {
    if (index === null) return;
    const next = { ...shownBand(index), ...patch };
    bandDraft.current = null;
    patchBand(s, channel, index, patch, shownBand(index));
    holdBand(s, { channelId: channel.id, kind: 'peq', index, band: next });
  }
</script>

<InspectorSection
  title={index !== null ? `Band ${index + 1}` : 'Band'}
  caption={band ? `${TYPE_LABELS[band.type]} · selected` : 'none selected'}
>
  <div class="body">
    <div class="row">
      <span class="prow-lbl">TYPE</span>
      <div class="type">
        {#if band && index !== null}
          <BandTypeSelect value={band.type} {types} onChange={(t) => patchBand(s, channel, index, { type: t })} />
        {:else}
          <span class="none">—</span>
        {/if}
      </div>
    </div>
    <SliderField
      lane="gesture"
      label="FREQUENCY"
      value={band?.frequency ?? 1000}
      min={Eq.FREQ_MIN_HZ}
      max={Eq.FREQ_MAX_HZ}
      step={Eq.FREQ_STEP_HZ}
      kind="hz"
      log
      disabled={locked}
      placeholder={dash(!off)}
      holdKey={`${channel.id}:${index}`}
      onPreview={(v) => preview({ frequency: v })}
      onChange={(v) => commit({ frequency: v })}
    />
    <SliderField
      lane="gesture"
      label="GAIN"
      value={band?.gain ?? 0}
      min={Eq.BAND_GAIN_MIN_DB}
      max={Eq.BAND_GAIN_MAX_DB}
      step={Eq.BAND_GAIN_STEP_DB}
      kind="dB-signed"
      tone="signed"
      disabled={locked || !gainOn}
      placeholder={dash(!off && gainOn)}
      holdKey={`${channel.id}:${index}`}
      onPreview={(v) => preview({ gain: v })}
      onChange={(v) => commit({ gain: v })}
    />
    <SliderField
      lane="gesture"
      label="Q"
      value={band?.q ?? 1}
      min={Eq.Q_MIN}
      max={Eq.Q_MAX}
      step={Eq.Q_STEP}
      kind="q"
      log
      disabled={locked || !qOn}
      placeholder={dash(!off && qOn)}
      holdKey={`${channel.id}:${index}`}
      onPreview={(v) => preview({ q: v })}
      onChange={(v) => commit({ q: v })}
    />
    <div class="row">
      <span class="prow-lbl">BYPASS</span>
      <BypassButton bypassed={band?.bypass ?? false} disabled={off} onToggle={() => index !== null && patchBand(s, channel, index, { bypass: !band?.bypass })} />
    </div>
  </div>
</InspectorSection>

<style>
  .body { height: 120px; padding: 0 4px; --rf-label: 76px; }
  .body :global(.prow) { border-top: none; --rf-track: auto; --rf-track-flex: 1; --rf-value: 78px; }
  .row { display: flex; align-items: center; gap: 12px; height: var(--h-row); }
  .type { flex: 1; min-width: 0; }
  .none { padding-left: 4px; color: var(--text-faint); font-family: var(--font-mono); font-size: var(--fs-l); }
</style>

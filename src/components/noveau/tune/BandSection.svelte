<script lang="ts">
  import BandTypeSelect, { TYPE_LABELS, offeredTypes } from '@/components/eq/BandTypeSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { Eq, FilterType, type ChannelModel } from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '../noveauUi.svelte';
  import InspectorSection from './InspectorSection.svelte';
  import RangeField from './RangeField.svelte';
  import { patchBand } from './bandOps';
  import { bandHasGain, bandHasQ } from './eqDraft';

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
</script>

<InspectorSection
  title={index !== null ? `Band ${index + 1}` : 'Band'}
  caption={band ? `${TYPE_LABELS[band.type]} · selected` : 'none selected'}
>
  <div class="body">
    <div class="row">
      <span class="lbl">TYPE</span>
      <div class="type">
        {#if band && index !== null}
          <BandTypeSelect value={band.type} {types} onChange={(t) => patchBand(s, channel, index, { type: t })} />
        {:else}
          <span class="none">—</span>
        {/if}
      </div>
    </div>
    <RangeField
      label="FREQUENCY"
      value={band?.frequency ?? 1000}
      min={Eq.FREQ_MIN_HZ}
      max={Eq.FREQ_MAX_HZ}
      step={Eq.FREQ_STEP_HZ}
      kind="hz"
      log
      disabled={locked}
      placeholder={dash(!off)}
      onCommit={(v) => index !== null && patchBand(s, channel, index, { frequency: v })}
    />
    <RangeField
      label="GAIN"
      value={band?.gain ?? 0}
      min={Eq.BAND_GAIN_MIN_DB}
      max={Eq.BAND_GAIN_MAX_DB}
      step={Eq.BAND_GAIN_STEP_DB}
      kind="dB-signed"
      tone="signed"
      disabled={locked || !gainOn}
      placeholder={dash(!off && gainOn)}
      onCommit={(v) => index !== null && patchBand(s, channel, index, { gain: v })}
    />
    <RangeField
      label="Q"
      value={band?.q ?? 1}
      min={Eq.Q_MIN}
      max={Eq.Q_MAX}
      step={Eq.Q_STEP}
      kind="q"
      log
      disabled={locked || !qOn}
      placeholder={dash(!off && qOn)}
      onCommit={(v) => index !== null && patchBand(s, channel, index, { q: v })}
    />
    <div class="row">
      <span class="lbl">BYPASS</span>
      <ToggleSwitch
        size="sm"
        checked={band?.bypass ?? false}
        disabled={off}
        ariaLabel="Bypass band"
        onChange={(v) => index !== null && patchBand(s, channel, index, { bypass: v })}
      />
    </div>
  </div>
</InspectorSection>

<style>
  .body { height: 120px; padding: 0 4px; --rf-label: 76px; --rf-value: 78px; }
  .body :global(.vf) { font-size: 12px; }
  .row { display: flex; align-items: center; gap: 10px; height: 24px; }
  .lbl { flex: 0 0 76px; font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); }
  .type { flex: 1; min-width: 0; }
  .none { padding-left: 4px; color: var(--text-faint); font-family: var(--font-mono); font-size: 12px; }
</style>

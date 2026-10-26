<script lang="ts">
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { Eq, inputIndexOf, type ChannelId } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import RangeField from './RangeField.svelte';
  import InspectorSection from './InspectorSection.svelte';

  const { channelId }: { channelId: ChannelId } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const features = $derived(s.device.capabilities.features);
  const slot = $derived(inputIndexOf(channelId));
  const preampDb = $derived(slot !== null ? (snap?.inputPreampDb[slot] ?? 0) : 0);
  const showLeveller = $derived(features.levellerMasks && slot !== null);

  const inMask = (mask: number | undefined): boolean => slot !== null && (((mask ?? 0xFF) >> slot) & 1) === 1;
</script>

<div class="stage">
  <div class="col" class:wide={!showLeveller}>
    <InspectorSection title="Input">
      {#if slot !== null}
        <div class="r">
          <RangeField
            label="PREAMP"
            value={preampDb}
            min={Eq.PREAMP_MIN_DB}
            max={Eq.PREAMP_MAX_DB}
            step={Eq.PREAMP_STEP_DB}
            kind="dB-signed"
            tone="signed"
            onPreview={(v) => Runtime.setInputPreamp(s, slot, v)}
            onCommit={(v) => Runtime.setInputPreamp(s, slot, v)}
          />
          <button type="button" class="chip hi" title="Reset preamp to 0 dB" disabled={preampDb === 0}
            onclick={() => Runtime.setInputPreamp(s, slot, 0)}>RESET</button>
        </div>
      {/if}
    </InspectorSection>
  </div>
  {#if showLeveller && slot !== null}
    <div class="col">
      <InspectorSection title="Leveller">
        <div class="r">
          <span class="lbl">DETECTOR</span>
          <ToggleSwitch size="sm" checked={inMask(snap?.leveller.detectorMask)} disabled={!snap?.leveller.enabled}
            ariaLabel="Leveller detector" onChange={() => Runtime.toggleLevellerDetectorChannel(s, slot)} />
        </div>
        <div class="r">
          <span class="lbl">APPLY</span>
          <ToggleSwitch size="sm" checked={inMask(snap?.leveller.applyMask)} disabled={!snap?.leveller.enabled}
            ariaLabel="Leveller apply" onChange={() => Runtime.toggleLevellerApplyChannel(s, slot)} />
        </div>
      </InspectorSection>
    </div>
  {/if}
</div>

<style>
  .stage {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24px;
    align-content: start;
    border-top: 1px solid var(--border);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .col { min-width: 0; }
  .col.wide { grid-column: 1 / -1; }
  .stage :global(.sec) { border-top: none; }
  .r {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 24px;
    border-top: 1px solid var(--border);
    --rf-label: 96px;
    --rf-value: 84px;
  }
  .r :global(.rf) { flex: 1; min-width: 0; height: 22px; }
  .lbl { flex: 0 0 96px; white-space: nowrap; font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); }
  .stage :global(.vf[data-size='md']) { height: 22px; font-size: 12px; }
  .chip { height: 20px; font-size: 11px; padding: 0 8px; }
</style>

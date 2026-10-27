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
  <div class="cols">
    <div class="col">
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
          </div>
          <div class="r">
            <span class="lbl">RESET</span>
            <span class="ctl">
              <button type="button" class="chip hi" aria-label="Reset preamp to 0 dB" disabled={preampDb === 0}
                onclick={() => Runtime.setInputPreamp(s, slot, 0)}>0 dB</button>
            </span>
          </div>
        {/if}
      </InspectorSection>
    </div>
    {#if showLeveller && slot !== null}
      <div class="col">
        <InspectorSection title="Leveller">
          <div class="r">
            <span class="lbl">DETECTOR</span>
            <span class="ctl"><ToggleSwitch size="sm" checked={inMask(snap?.leveller.detectorMask)} disabled={!snap?.leveller.enabled}
              ariaLabel="Leveller detector" onChange={() => Runtime.toggleLevellerDetectorChannel(s, slot)} /></span>
          </div>
          <div class="r">
            <span class="lbl">APPLY</span>
            <span class="ctl"><ToggleSwitch size="sm" checked={inMask(snap?.leveller.applyMask)} disabled={!snap?.leveller.enabled}
              ariaLabel="Leveller apply" onChange={() => Runtime.toggleLevellerApplyChannel(s, slot)} /></span>
          </div>
        </InspectorSection>
      </div>
    {/if}
  </div>
</div>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .cols { display: flex; align-items: flex-start; min-width: 0; }
  .col { flex: 0 0 320px; min-width: 0; }
  .col + .col { border-left: 1px solid var(--border); padding-left: 16px; margin-left: 16px; }
  .stage :global(.sec) { border-top: none; }
  .r {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 24px;
    border-top: 1px solid var(--border);
    --rf-label: 84px;
    --rf-value: 72px;
    --rf-track: 140px;
    --rf-track-flex: 0 0 auto;
  }
  .r :global(.rf) { flex: 0 0 auto; gap: 12px; height: 22px; }
  .lbl { flex: 0 0 84px; font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); white-space: nowrap; }
  .ctl { display: flex; align-items: center; gap: 6px; }
  .stage :global(.vf) { height: 22px; font-size: 12px; }
  .chip { height: 20px; font-size: 11px; padding: 0 8px; }
</style>

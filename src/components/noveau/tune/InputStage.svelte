<script lang="ts">
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import SliderField from '@/components/chrome/SliderField.svelte';
  import { Eq, inputIndexOf, type ChannelId } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import InspectorSection from './InspectorSection.svelte';

  const { channelId }: { channelId: ChannelId } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const slot = $derived(inputIndexOf(channelId));
  const preampDb = $derived(slot !== null ? (snap?.inputPreampDb[slot] ?? 0) : 0);
  const showLeveller = $derived(slot !== null);
  const inMask = (mask: number | undefined): boolean => slot !== null && (((mask ?? 0xFF) >> slot) & 1) === 1;
</script>

<div class="stage">
  <div class="cols">
    <div class="col">
      <InspectorSection title="Input">
        {#if slot !== null}
          <SliderField
            lane="scrub"
            label="PREAMP"
            value={preampDb}
            min={Eq.PREAMP_MIN_DB}
            max={Eq.PREAMP_MAX_DB}
            step={Eq.PREAMP_STEP_DB}
            kind="dB-signed"
            tone="signed"
            resetTo={0}
            holdKey={channelId}
            onChange={(v) => Runtime.setInputPreampLinked(s, channelId, v)}
          />
        {/if}
      </InspectorSection>
    </div>
    {#if showLeveller && slot !== null}
      <div class="col">
        <InspectorSection title="Leveller">
          <div class="prow">
            <span class="prow-lbl">DETECTOR</span>
            <span class="prow-ctl"><ToggleSwitch checked={inMask(snap?.leveller.detectorMask)} disabled={!snap?.leveller.enabled}
              ariaLabel="Leveller detector" onChange={() => Runtime.toggleLevellerDetectorChannel(s, slot)} /></span>
          </div>
          <div class="prow">
            <span class="prow-lbl">APPLY</span>
            <span class="prow-ctl"><ToggleSwitch checked={inMask(snap?.leveller.applyMask)} disabled={!snap?.leveller.enabled}
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
  .stage :global(.prow) { --rf-track: auto; --rf-track-flex: 1; }
</style>

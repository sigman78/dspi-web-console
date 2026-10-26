<script lang="ts">
  import LabeledSlider from '@/components/chrome/LabeledSlider.svelte';
  import { Eq, inputIndexOf, type ChannelId } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const { channelId }: { channelId: ChannelId } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const features = $derived(s.device.capabilities.features);
  const slot = $derived(inputIndexOf(channelId));
  const preampDb = $derived(slot !== null ? (snap?.inputPreampDb[slot] ?? 0) : 0);

  const inMask = (mask: number | undefined): boolean => slot !== null && (((mask ?? 0xFF) >> slot) & 1) === 1;
</script>

<div class="stage">
  <div class="line">
    {#if slot !== null}
      <div class="pre">
        <LabeledSlider
          label="PREAMP"
          ariaLabel="Input preamp"
          value={preampDb}
          min={Eq.PREAMP_MIN_DB}
          max={Eq.PREAMP_MAX_DB}
          step={Eq.PREAMP_STEP_DB}
          kind="dB-signed"
          precision={1}
          onChange={(v) => Runtime.setInputPreamp(s, slot, v)}
        />
      </div>
      <button type="button" class="chip hi" title="Reset preamp to 0 dB" disabled={preampDb === 0}
        onclick={() => Runtime.setInputPreamp(s, slot, 0)}>RESET</button>
    {/if}
  </div>
  <div class="line">
    <span class="grow"></span>
    {#if features.levellerMasks && slot !== null}
      <span class="chips">
        <button type="button" class="chip hi" class:on={inMask(snap?.leveller.detectorMask)} aria-pressed={inMask(snap?.leveller.detectorMask)}
          disabled={!snap?.leveller.enabled}
          onclick={() => Runtime.toggleLevellerDetectorChannel(s, slot)}>LEV DET</button>
        <button type="button" class="chip hi" class:on={inMask(snap?.leveller.applyMask)} aria-pressed={inMask(snap?.leveller.applyMask)}
          disabled={!snap?.leveller.enabled}
          onclick={() => Runtime.toggleLevellerApplyChannel(s, slot)}>LEV APPLY</button>
      </span>
    {/if}
  </div>
</div>

<style>
  .stage {
    display: grid;
    grid-template-rows: 32px 32px;
    border-top: 1px solid var(--border);
    min-width: 0;
  }
  .line { display: flex; align-items: center; gap: 12px; min-width: 0; overflow: hidden; }
  .grow { flex: 1; }
  .pre {
    flex: 0 0 420px;
    display: grid;
    grid-template-columns: 56px 1fr 84px;
    align-items: center;
    gap: 10px;
  }
  .pre :global(.microlbl) { font-family: var(--font-sans); font-size: 11px; font-weight: 400; letter-spacing: 0; color: var(--text-dim); }
  .pre :global(.vf) { font-size: 12px; }
  .chips { display: inline-flex; gap: 6px; }
  .chip { height: 20px; font-size: 11px; padding: 0 8px; }
</style>

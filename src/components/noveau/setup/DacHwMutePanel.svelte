<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinPicker from '@/components/chrome/PinPicker.svelte';
  import NumField from '@/components/chrome/NumField.svelte';
  import { stageDacMute, stageDacMuteEnabled, stagedCtrlPins, testDacHwMute } from '@/runtime';
  import { pickerCells } from '@/domain';
  import { DAC_HW_MUTE_HOLD_MS_MIN, DAC_HW_MUTE_HOLD_MS_MAX, DAC_HW_MUTE_RELEASE_MS_MAX } from '@/domain/clamp';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const live = $derived(s.mirror.current);
  const snap = $derived(live ? s.staging.overlaySnapshot(live) : null);
  const cfg = $derived(snap?.dacHwMute);
  const editable = $derived(cfg != null && cfg.enabled);
  const ctrlPins = $derived(stagedCtrlPins(s));

  let testBusy = $state(false);
  let testTimer: ReturnType<typeof setTimeout> | null = null;

  // Cancel a pending test-pulse timeout on unmount so it doesn't flip
  // testBusy on a dead component.
  $effect(() => {
    return () => {
      if (testTimer != null) clearTimeout(testTimer);
    };
  });

  function onTest() {
    if (testBusy) return;
    testBusy = true;
    testDacHwMute(s);
    testTimer = setTimeout(() => { testBusy = false; testTimer = null; }, 1500);
  }
</script>

<Panel title="DAC HW MUTE">
  {#snippet right()}
    <span class="stage-wrap" class:staged={s.staging.has('dacMute:enabled')}>
      <ToggleSwitch
        checked={cfg?.enabled ?? false}
        disabled={!cfg}
        ariaLabel={cfg?.enabled ? 'Disable DAC HW mute' : 'Enable DAC HW mute'}
        onChange={(v) => stageDacMuteEnabled(s, v)}
      />
    </span>
  {/snippet}

  {#if cfg && snap}
    <div class="rows">
      <div class="row">
        <span class="stage-wrap" class:staged={s.staging.has('dacMute:activeLow')}>
          <ToggleSwitch
            label="ACTIVE LOW"
            ariaLabel="DAC mute active low"
            checked={cfg.activeLow}
            disabled={!editable}
            onChange={(v) => stageDacMute(s, 'activeLow', v)}
          />
        </span>
      </div>

      <div class="row">
        <span class="microlbl">GPIO PIN</span>
        <span class="stage-wrap" class:staged={s.staging.has('dacMute:pin')}>
          <PinPicker
            value={cfg.pin}
            cells={pickerCells(snap.platform.type, snap, ctrlPins, cfg.pin)}
            ariaLabel="DAC HW mute GPIO pin"
            disabled={!editable}
            onChange={(p) => stageDacMute(s, 'pin', p)}
          />
        </span>
      </div>

      <div class="row">
        <span class="microlbl">HOLD MS</span>
        <span class="stage-wrap" class:staged={s.staging.has('dacMute:holdMs')}>
          <NumField
            value={cfg.holdMs}
            min={DAC_HW_MUTE_HOLD_MS_MIN}
            max={DAC_HW_MUTE_HOLD_MS_MAX}
            step={1}
            kind="int"
            disabled={!editable}
            ariaLabel="DAC mute hold time ms"
            onChange={(v) => stageDacMute(s, 'holdMs', v)}
          />
        </span>
      </div>

      <div class="row">
        <span class="microlbl">RELEASE MS</span>
        <span class="stage-wrap" class:staged={s.staging.has('dacMute:releaseMs')}>
          <NumField
            value={cfg.releaseMs}
            min={0}
            max={DAC_HW_MUTE_RELEASE_MS_MAX}
            step={1}
            kind="int"
            disabled={!editable}
            ariaLabel="DAC mute release time ms"
            onChange={(v) => stageDacMute(s, 'releaseMs', v)}
          />
        </span>
      </div>

      <div class="row test-row">
        <button
          class="chip warn"
          onclick={onTest}
          disabled={!live?.dacHwMute.enabled || testBusy}
          title="Pulse the DAC mute pin for ~1 s to verify wiring"
        >{testBusy ? 'TESTING…' : 'TEST PULSE'}</button>
      </div>
    </div>
  {/if}
</Panel>

<style>
  .rows { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .test-row { justify-content: flex-start; margin-top: 4px; }
</style>

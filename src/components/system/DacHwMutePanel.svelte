<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { setDacHwMute, testDacHwMute } from '@/runtime';
  import { availablePinsFor, assignablePins, isAssignablePin, pinsInUse, type DacHwMute } from '@/domain';
  import { DAC_HW_MUTE_HOLD_MS_MIN, DAC_HW_MUTE_HOLD_MS_MAX, DAC_HW_MUTE_RELEASE_MS_MAX } from '@/domain/clamp';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cfg = $derived(snap?.dacHwMute);
  const editable = $derived(connected && cfg != null && cfg.enabled);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c });

  let testBusy = $state(false);
  let testTimer: ReturnType<typeof setTimeout> | null = null;

  // Cancel a pending test-pulse timeout on unmount so it doesn't flip
  // testBusy on a dead component.
  $effect(() => {
    return () => {
      if (testTimer != null) clearTimeout(testTimer);
    };
  });

  function patch(p: Partial<DacHwMute>) {
    if (editable) setDacHwMute(s, p);
  }

  // The firmware zeroes the whole struct on disable and silently rejects an
  // enabled write whose pin is invalid or taken, so the enable write must
  // ship a usable pin up front: the stored one when free, else the first
  // free assignable pin. Timings are clamped into range by the runtime verb.
  function onToggleEnabled() {
    if (!cfg || !snap) return;
    if (cfg.enabled) {
      setDacHwMute(s, { enabled: false });
      return;
    }
    const inUse = pinsInUse(snap, ctrlPins);
    const free = (p: number) => isAssignablePin(snap.platform.type, p, snap.platform.wireGen) && !inUse.has(p);
    const pin = free(cfg.pin) ? cfg.pin : (assignablePins(snap.platform.type, snap.platform.wireGen).find(free) ?? cfg.pin);
    setDacHwMute(s, { enabled: true, pin });
  }

  function onToggleActiveLow(v: boolean) {
    patch({ activeLow: v });
  }

  function onPin(pin: number) {
    patch({ pin });
  }

  // No clamping here: Clamp.* in the setDacHwMute verb is the sole authority;
  // the input min/max attributes are a UI affordance over the same bounds.
  function onHoldMs(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isNaN(v)) patch({ holdMs: v });
  }

  function onReleaseMs(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isNaN(v)) patch({ releaseMs: v });
  }

  function onTest() {
    if (testBusy) return;
    testBusy = true;
    testDacHwMute(s);
    testTimer = setTimeout(() => { testBusy = false; testTimer = null; }, 1500);
  }
</script>

<Panel code="SY.10" title="DAC HW MUTE">
  {#snippet right()}
    <ToggleSwitch
      size="sm"
      checked={cfg?.enabled ?? false}
      disabled={!connected || !cfg}
      ariaLabel={cfg?.enabled ? 'Disable DAC HW mute' : 'Enable DAC HW mute'}
      onChange={() => onToggleEnabled()}
    />
  {/snippet}

  {#if cfg && snap}
    <div class="rows" class:dimmed={!cfg.enabled}>
      <div class="row">
        <ToggleSwitch
          size="sm"
          label="ACTIVE LOW"
          ariaLabel="DAC mute active low"
          checked={cfg.activeLow}
          disabled={!editable}
          onChange={onToggleActiveLow}
        />
      </div>

      <div class="row">
        <span class="microlbl">GPIO PIN</span>
        <PinSelect
          value={cfg.pin}
          candidates={availablePinsFor(snap.platform.type, snap, cfg.pin, ctrlPins)}
          ariaLabel="DAC HW mute GPIO pin"
          disabled={!editable}
          onChange={onPin}
        />
      </div>

      <div class="row">
        <span class="microlbl">HOLD MS</span>
        <input
          class="numfield"
          type="number"
          min={DAC_HW_MUTE_HOLD_MS_MIN}
          max={DAC_HW_MUTE_HOLD_MS_MAX}
          step="1"
          value={cfg.holdMs}
          onchange={onHoldMs}
          disabled={!editable}
          aria-label="DAC mute hold time ms"
        />
      </div>

      <div class="row">
        <span class="microlbl">RELEASE MS</span>
        <input
          class="numfield"
          type="number"
          min="0"
          max={DAC_HW_MUTE_RELEASE_MS_MAX}
          step="1"
          value={cfg.releaseMs}
          onchange={onReleaseMs}
          disabled={!editable}
          aria-label="DAC mute release time ms"
        />
      </div>

      <div class="row test-row">
        <button
          class="chip warn"
          onclick={onTest}
          disabled={!connected || !cfg.enabled || testBusy}
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
  /* Base input styling comes from the global input[type="number"] rule. */
  .numfield {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    width: 80px;
    text-align: right;
  }
</style>

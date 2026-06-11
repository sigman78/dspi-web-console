<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { setDacHwMute, testDacHwMute } from '@/runtime';
  import { availablePinsFor, assignablePins, isAssignablePin, pinsInUse, type DacHwMute } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cfg = $derived(snap?.dacHwMute);
  const editable = $derived(connected && cfg != null && cfg.enabled);

  let testBusy = $state(false);

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
    const inUse = pinsInUse(snap);
    const free = (p: number) => isAssignablePin(snap.platform.type, p) && !inUse.has(p);
    const pin = free(cfg.pin) ? cfg.pin : (assignablePins(snap.platform.type).find(free) ?? cfg.pin);
    setDacHwMute(s, { enabled: true, pin });
  }

  function onToggleActiveLow(v: boolean) {
    patch({ activeLow: v });
  }

  function onPin(pin: number) {
    patch({ pin });
  }

  function onHoldMs(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isNaN(v)) patch({ holdMs: Math.max(0, v) });
  }

  function onReleaseMs(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isNaN(v)) patch({ releaseMs: Math.max(0, v) });
  }

  function onTest() {
    if (testBusy) return;
    testBusy = true;
    testDacHwMute(s);
    setTimeout(() => { testBusy = false; }, 1500);
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
        <span class="lbl">GPIO PIN</span>
        <PinSelect
          value={cfg.pin}
          candidates={availablePinsFor(snap.platform.type, snap, cfg.pin)}
          ariaLabel="DAC HW mute GPIO pin"
          disabled={!editable}
          onChange={onPin}
        />
      </div>

      <div class="row">
        <span class="lbl">HOLD MS</span>
        <input
          class="numfield"
          type="number"
          min="1"
          max="500"
          step="1"
          value={cfg.holdMs}
          onchange={onHoldMs}
          disabled={!editable}
          aria-label="DAC mute hold time ms"
        />
      </div>

      <div class="row">
        <span class="lbl">RELEASE MS</span>
        <input
          class="numfield"
          type="number"
          min="0"
          max="500"
          step="1"
          value={cfg.releaseMs}
          onchange={onReleaseMs}
          disabled={!editable}
          aria-label="DAC mute release time ms"
        />
      </div>

      <div class="row test-row">
        <button
          class="test-btn"
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
  .rows.dimmed { opacity: 0.45; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .test-row { justify-content: flex-start; margin-top: 4px; }
  .lbl {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    color: var(--text-faint);
    white-space: nowrap;
  }
  .numfield {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    width: 80px;
    text-align: right;
  }
  .numfield:disabled { opacity: 0.4; }
  .test-btn {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 4px 12px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    border: 1px solid color-mix(in oklab, var(--warn) 50%, var(--border));
    color: var(--warn);
    cursor: pointer;
  }
  .test-btn:hover:not(:disabled) { background: color-mix(in oklab, var(--warn) 16%, transparent); }
  .test-btn:disabled { opacity: 0.4; cursor: default; }
</style>

<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { setDacHwMute, testDacHwMute } from '@/runtime';
  import { availablePinsFor } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const cfg = $derived(snap?.dacHwMute ?? null);

  let testBusy = $state(false);

  function onToggleEnabled() {
    if (!cfg || !snap) return;
    setDacHwMute(s, { ...cfg, enabled: !cfg.enabled });
  }

  function onToggleActiveLow() {
    if (!cfg || !snap) return;
    setDacHwMute(s, { ...cfg, activeLow: !cfg.activeLow });
  }

  function onPin(pin: number) {
    if (!cfg) return;
    setDacHwMute(s, { ...cfg, pin });
  }

  function onHoldMs(e: Event) {
    if (!cfg) return;
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isNaN(v)) setDacHwMute(s, { ...cfg, holdMs: Math.max(0, v) });
  }

  function onReleaseMs(e: Event) {
    if (!cfg) return;
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isNaN(v)) setDacHwMute(s, { ...cfg, releaseMs: Math.max(0, v) });
  }

  function onTest() {
    if (testBusy) return;
    testBusy = true;
    testDacHwMute(s);
    setTimeout(() => { testBusy = false; }, 1500);
  }
</script>

<Panel code="SY.10" title="DAC HW MUTE">
  {#if cfg !== null && snap !== null}
    <div class="rows">
      <div class="row">
        <span class="lbl">ENABLED</span>
        <button
          class="toggle"
          class:on={cfg.enabled}
          onclick={onToggleEnabled}
          disabled={!connected}
        >{cfg.enabled ? 'YES' : 'NO'}</button>
      </div>

      <div class="row">
        <span class="lbl">ACTIVE LOW</span>
        <button
          class="toggle"
          class:on={cfg.activeLow}
          onclick={onToggleActiveLow}
          disabled={!connected}
        >{cfg.activeLow ? 'YES' : 'NO'}</button>
      </div>

      <div class="row">
        <span class="lbl">GPIO PIN</span>
        <PinSelect
          value={cfg.pin}
          candidates={availablePinsFor(snap.platform.type, snap, cfg.pin)}
          ariaLabel="DAC HW mute GPIO pin"
          disabled={!connected}
          onChange={onPin}
        />
      </div>

      <div class="row">
        <span class="lbl">HOLD MS</span>
        <input
          class="numfield"
          type="number"
          min="0"
          max="5000"
          step="1"
          value={cfg.holdMs}
          onchange={onHoldMs}
          disabled={!connected}
          aria-label="DAC mute hold time ms"
        />
      </div>

      <div class="row">
        <span class="lbl">RELEASE MS</span>
        <input
          class="numfield"
          type="number"
          min="0"
          max="5000"
          step="1"
          value={cfg.releaseMs}
          onchange={onReleaseMs}
          disabled={!connected}
          aria-label="DAC mute release time ms"
        />
      </div>

      <div class="row test-row">
        <button
          class="test-btn"
          onclick={onTest}
          disabled={!connected || testBusy}
          title="Pulse the DAC mute pin for ~1 s to verify wiring"
        >{testBusy ? 'TESTING…' : 'TEST PULSE'}</button>
      </div>
    </div>
  {:else}
    <p class="na">Not available on this firmware.</p>
  {/if}
</Panel>

<style>
  .rows { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
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
  .toggle {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 3px 8px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-faint);
    cursor: pointer;
    min-width: 40px;
  }
  .toggle:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .toggle:disabled { opacity: 0.4; cursor: default; }
  .toggle.on {
    background: color-mix(in oklab, var(--ok) 12%, transparent);
    border-color: color-mix(in oklab, var(--ok) 50%, var(--border));
    color: var(--ok);
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
  .na { font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); padding: 12px 14px; margin: 0; }
</style>

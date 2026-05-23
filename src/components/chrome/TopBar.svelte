<script lang="ts">
  import Telem from './Telem.svelte';
  import StatusPill from './StatusPill.svelte';
  import DirtyDot from './DirtyDot.svelte';
  import MasterVolumeMini from './MasterVolumeMini.svelte';
  import PresetActiveChip from './PresetActiveChip.svelte';
  import { status, session, dsp } from '@/state';
  import { setBypass } from '@/runtime';

  const connected = $derived(session.status === 'connected');
  const info = $derived(status.info);
  const bypassed = $derived(dsp.draft?.bypass ?? false);

  const cpu0 = $derived(connected ? `${status.cpu0}%` : '—');
  const cpu1 = $derived(connected ? `${status.cpu1}%` : '—');
  const fsKHz = $derived(
    connected && info?.sampleRateHz != null ? `${(info.sampleRateHz / 1000).toFixed(0)}k` : '—'
  );
  const voltage = $derived(
    connected && info?.coreVoltageMv != null ? (info.coreVoltageMv / 1000).toFixed(2) : '—'
  );
  const temp = $derived(
    connected && info?.tempCDegC != null ? (info.tempCDegC / 100).toFixed(1) : '—'
  );
  const clkMHz = $derived(
    connected && info?.clockHz != null ? `${Math.round(info.clockHz / 1_000_000)}M` : '—'
  );
</script>

<div class="topbar">
  <div class="brand">
    <div class="cube">D</div>
    <span class="title">DSPI · CTRL</span>
    <span class="version">v0.0 / WebUSB</span>
  </div>

  <div class="spacer"></div>

  <Telem label="CPU0" value={cpu0} bar={connected ? status.cpu0 / 100 : undefined} />
  <Telem label="CPU1" value={cpu1} bar={connected ? status.cpu1 / 100 : undefined} />
  <Telem label="FS"   value={fsKHz} />
  <Telem label="CLK"  value={clkMHz} />
  <Telem label="V"    value={voltage} />
  <Telem label="T°"   value={temp} />

  <span class="div"></span>

  <MasterVolumeMini />

  <button
    class="bypass"
    class:on={bypassed}
    onclick={() => setBypass(!bypassed)}
    disabled={!connected}
    title={bypassed ? 'EQ bypass on (signal passes through)' : 'EQ active'}
    aria-label={bypassed ? 'Disable EQ bypass' : 'Enable EQ bypass'}
    aria-pressed={bypassed}
  >
    {#if bypassed}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <line x1="2" y1="8" x2="14" y2="8" />
      </svg>
    {:else}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 11 C 5 11, 6 5, 8 5 S 11 11, 14 11" />
      </svg>
    {/if}
  </button>

  <StatusPill />
  <DirtyDot />

  <PresetActiveChip />
</div>

<style>
  .topbar {
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    font-family: var(--font-mono);
    border-bottom: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg) 70%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .cube {
    width: 22px; height: 22px;
    border-radius: 5px;
    position: relative;
    background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 33%, transparent));
    box-shadow: 0 0 18px color-mix(in oklab, var(--accent) 33%, transparent);
    color: var(--text); font-weight: 700; font-size: 9px;
    display: flex; align-items: center; justify-content: center;
  }
  .title { font-size: 12px; font-weight: 600; letter-spacing: 1px; }
  .version { font-size: 9px; color: var(--text-faint); }
  .spacer { flex: 1; }
  .div { width: 1px; height: 22px; background: var(--border); }
  .bypass {
    width: 26px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .bypass:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-hi);
  }
  .bypass:disabled { cursor: default; opacity: 0.5; }
  .bypass.on {
    background: color-mix(in oklab, var(--err) 15%, transparent);
    border-color: color-mix(in oklab, var(--err) 45%, transparent);
    color: var(--err);
  }
</style>

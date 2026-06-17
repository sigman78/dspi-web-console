<script lang="ts">
  import Telem from './Telem.svelte';
  import StatusPill from './StatusPill.svelte';
  import DirtyDot from './DirtyDot.svelte';
  import MasterVolumeMini from './MasterVolumeMini.svelte';
  import PresetActiveChip from '@/components/presets/PresetActiveChip.svelte';
  import { connection, activeSession } from '@/state';
  import { setBypass, webUsbUnsupportedReason } from '@/runtime';
  import { chromeConnectionStatus } from './connectionStatus';
  import { APP_VERSION, GIT_SHA, BUILD_DATE, REPO_URL } from '@/buildInfo';

  const s = $derived(activeSession());
  const connected = $derived(connection.connected);
  const info = $derived(s?.telemetry.info ?? null);
  const bypassed = $derived(s?.mirror.current?.bypass ?? false);

  const status = $derived(
    chromeConnectionStatus({
      phase: connection.phase,
      connected: connection.connected,
      degraded: connected && (s?.health.degraded ?? false),
      unsupported: webUsbUnsupportedReason() !== null,
    })
  );

  const cpu0 = $derived(connected ? `${s?.telemetry.cpu0 ?? 0}%` : '—');
  const cpu1 = $derived(connected ? `${s?.telemetry.cpu1 ?? 0}%` : '—');
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
    <div
      class="cube"
      class:tone-warn={status.tone === 'warn'}
      class:tone-err={status.tone === 'err'}
      class:tone-idle={status.tone === 'idle'}
      title="DSPI · CTRL v{APP_VERSION} · {GIT_SHA} · {BUILD_DATE}"
    >D</div>
    <span class="title">DSPI · CTRL</span>
    <span class="version" title="Build {GIT_SHA} · {BUILD_DATE}">v{APP_VERSION}</span>
    <a
      class="gh"
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      title="GitHub repository"
      aria-label="GitHub repository"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
      </svg>
    </a>
  </div>

  {#if status.showPill}
    <StatusPill />
  {/if}

  <div class="spacer"></div>

  <Telem label="CPU0" value={cpu0} bar={connected ? (s?.telemetry.cpu0 ?? 0) / 100 : undefined} />
  <Telem label="CPU1" value={cpu1} bar={connected ? (s?.telemetry.cpu1 ?? 0) / 100 : undefined} />
  <Telem label="FS"   value={fsKHz} />
  <Telem label="CLK"  value={clkMHz} />
  <Telem label="V"    value={voltage} />
  <Telem label="T°"   value={temp} />

  <span class="div"></span>

  <MasterVolumeMini />

  <button
    class="bypass"
    class:on={bypassed}
    onclick={() => { if (s) setBypass(s, !bypassed); }}
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
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    /* Align with the channel rail column (rail width 196px minus the topbar's
       16px right padding to the divider rhythm). */
    min-width: 180px;
  }
  .cube {
    width: 22px; height: 22px;
    border-radius: 5px;
    position: relative;
    background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 33%, transparent));
    box-shadow: 0 0 18px color-mix(in oklab, var(--accent) 33%, transparent);
    color: var(--text); font-weight: 700; font-size: 9px;
    display: flex; align-items: center; justify-content: center;
  }
  .cube.tone-warn {
    background: linear-gradient(135deg, var(--warn), color-mix(in oklab, var(--warn) 33%, transparent));
    box-shadow: 0 0 18px color-mix(in oklab, var(--warn) 33%, transparent);
  }
  .cube.tone-err {
    background: linear-gradient(135deg, var(--err), color-mix(in oklab, var(--err) 33%, transparent));
    box-shadow: 0 0 18px color-mix(in oklab, var(--err) 33%, transparent);
  }
  .cube.tone-idle {
    background: color-mix(in oklab, var(--text) 12%, transparent);
    box-shadow: none;
    color: var(--text-dim);
  }
  .title { font-size: 12px; font-weight: 600; letter-spacing: 1px; }
  .version { font-size: 9px; color: var(--text-faint); letter-spacing: 0.5px; }
  .gh {
    display: inline-flex;
    align-items: center;
    color: var(--text-faint);
  }
  .gh:hover { color: var(--text); }
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

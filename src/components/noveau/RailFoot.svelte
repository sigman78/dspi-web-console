<script lang="ts">
  import { connection } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { clearClips, webUsbUnsupportedReason } from '@/runtime';
  import { formatRateKHz } from '@/utils';
  import Telem from '@/components/chrome/Telem.svelte';
  import { chromeConnectionStatus } from '@/components/chrome/connectionStatus';
  import { noveauUi } from './noveauUi.svelte';

  const s = getSession();
  const connected = $derived(connection.connected);
  const info = $derived(s.telemetry.info);
  const tone = $derived(chromeConnectionStatus({
    phase: connection.phase,
    connected,
    degraded: connected && s.health.degraded,
    unsupported: webUsbUnsupportedReason() !== null,
  }).tone);
  const label = $derived(
    tone === 'ok' ? 'Nominal' : tone === 'warn' ? 'Degraded' : tone === 'err' ? 'Error' : 'Idle',
  );
  const anyClip = $derived(s.telemetry.clipLatched.some(Boolean));

  const cpu0 = $derived(s.telemetry.cpu0);
  const cpu1 = $derived(s.telemetry.cpu1);
  const rate = $derived(info?.sampleRateHz != null ? formatRateKHz(info.sampleRateHz) : '—');
  const clock = $derived(info?.clockHz != null ? `${Math.round(info.clockHz / 1_000_000)} MHz` : '—');
  const voltage = $derived(info?.coreVoltageMv != null ? `${(info.coreVoltageMv / 1000).toFixed(2)} V` : '—');
  const temp = $derived(info?.tempCDegC != null ? `${(info.tempCDegC / 100).toFixed(1)} °C` : '—');

  function onWindowPointerDown(e: PointerEvent): void {
    if (!noveauUi.healthOpen) return;
    if ((e.target as Element | null)?.closest('.foot-wrap')) return;
    noveauUi.healthOpen = false;
  }
  function onWindowKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && noveauUi.healthOpen) noveauUi.healthOpen = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div class="foot-wrap">
  {#if noveauUi.healthOpen}
    <div class="pop" role="dialog" aria-label="Device health">
      <div class="grid">
        <Telem label="CPU0" value={connected ? `${cpu0}%` : '—'} bar={connected ? cpu0 / 100 : undefined} />
        <Telem label="CPU1" value={connected ? `${cpu1}%` : '—'} bar={connected ? cpu1 / 100 : undefined} />
        <Telem label="RATE" value={rate} />
        <Telem label="CLOCK" value={clock} />
        <Telem label="VOLTAGE" value={voltage} />
        <Telem label="TEMP" value={temp} />
      </div>
      {#if anyClip}
        <button type="button" class="chip warn" onclick={() => clearClips(s)}>CLEAR CLIPS</button>
      {/if}
    </div>
  {/if}
  <button
    type="button"
    class="foot"
    aria-expanded={noveauUi.healthOpen}
    onclick={() => { noveauUi.healthOpen = !noveauUi.healthOpen; }}
  >
    <span class="dot {tone}"></span>
    <span>{label}</span>
    <small>{noveauUi.healthOpen ? '▾' : '▴'}</small>
  </button>
</div>

<style>
  .foot-wrap { position: relative; flex: none; height: 30px; border-top: 1px solid var(--border); }
  .foot {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .foot:hover { color: var(--text); }
  .foot small { margin-left: auto; font-size: 11px; color: var(--text-faint); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-faint); flex: none; }
  .dot.ok { background: var(--ok); box-shadow: 0 0 6px color-mix(in oklab, var(--ok) 60%, transparent); }
  .dot.warn { background: var(--warn); }
  .dot.err { background: var(--err); }
  .pop {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: calc(100% + 4px);
    z-index: var(--z-flyout);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-radius: 8px;
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    box-shadow: 0 12px 32px oklch(0% 0 0 / 0.5);
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
</style>

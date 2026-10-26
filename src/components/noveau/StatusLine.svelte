<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import { formatRateKHz } from '@/utils';

  const s = getSession();
  const caps = $derived(s.info.capabilities);
  const rateHz = $derived(s.telemetry.info?.sampleRateHz);
  const rate = $derived(rateHz != null ? formatRateKHz(rateHz) : '—');
  const entries = $derived(s.staging.entries);
  const applying = $derived(s.staging.applying);
  const busy = $derived(s.writes.busy);
  const summary = $derived(entries.map((e) => `${e.label} ${e.from}→${e.to}`).join('\n'));
  const staged = $derived(entries.length > 0 || applying);
</script>

<div class="status">
  <span class="l">{caps.fwLabel} · {caps.wireLabel} · {rate} · link {s.health.degraded ? 'degraded' : 'OK'}</span>
  {#if staged}
    <span class="r">
      <span class="dot"></span>
      <b title={summary}>{entries.length} {entries.length === 1 ? 'change' : 'changes'}</b>
      <button type="button" class="chip accent" title="Applies together — brief audio mute" disabled={applying || busy} onclick={() => void s.staging.applyAll()}>APPLY</button>
      <button type="button" class="chip hi" disabled={applying} onclick={() => s.staging.discardAll()}>DISCARD</button>
    </span>
  {:else}
    <span class="r idle"><span class="dot"></span>nothing staged</span>
  {/if}
</div>

<style>
  .status {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-top: 1px solid var(--border-hi);
    background: color-mix(in oklab, var(--bg) 85%, oklch(0% 0 0));
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
  }
  .l { white-space: nowrap; }
  .r { display: flex; align-items: center; gap: 12px; color: var(--text-dim); font-family: var(--font-sans); }
  .r b { font-weight: 500; }
  .r.idle { color: var(--text-faint); font-family: var(--font-mono); gap: 8px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
  .idle .dot { background: var(--text-faint); opacity: 0.5; }
  .chip { height: 20px; padding: 0 10px; font-size: 11px; }
</style>

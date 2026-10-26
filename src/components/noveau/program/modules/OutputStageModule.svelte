<script lang="ts">
  import { untrack } from 'svelte';
  import { selectChannel } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '../../noveauUi.svelte';
  import { fmtSigned } from '../chainModel';
  import ModuleFrame from './ModuleFrame.svelte';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const features = $derived(s.device.capabilities.features);
  const showLimiter = $derived(features.limiter);

  const rows = $derived(
    (snap?.outputs ?? []).map((o) => ({
      out: o,
      name: snap?.channels.find((c) => c.id === o.id)?.name ?? o.shortName,
      lim: snap?.limiter[o.wireIndex],
      gr: s.telemetry.limiterMeterDb?.[o.wireIndex],
    })),
  );

  $effect(() => {
    if (!showLimiter) return;
    return untrack(() => s.telemetry.wantLimiterMeter());
  });

  const grText = (v: number | undefined): string => (v === undefined ? '—' : v >= 0.05 ? `−${v.toFixed(1)}` : '0.0');

  function edit(id: (typeof rows)[number]['out']['id']): void {
    selectChannel(id);
    noveauUi.destination = 'tune';
  }
</script>

<ModuleFrame title="Output stage" pass="per output · EQ → gain → delay → limiter">
  <div class="r tbl hd" class:nolim={!showLimiter}>
    <span>OUTPUT</span><span class="num">TRIM dB</span><span class="num">DELAY ms</span><span>MUTE</span>
    {#if showLimiter}<span>LIMIT</span><span class="num">GR dB</span>{/if}<span></span>
  </div>
  {#each rows as row (row.out.id)}
    <div class="r tbl" class:nolim={!showLimiter} class:off={!row.out.enabled}>
      <span class="nm" title={row.name}>{row.name}</span>
      <span class="num mono">{fmtSigned(row.out.gainDb)}</span>
      <span class="num mono">{row.out.delayMs.toFixed(1)}</span>
      <span class="mono">{row.out.muted ? 'MUTE' : '—'}</span>
      {#if showLimiter}
        <span class="mono">{row.lim?.enabled ? 'ON' : '—'}</span>
        <span class="num mono">{row.lim?.enabled ? grText(row.gr) : '—'}</span>
      {/if}
      <button type="button" class="jump" aria-label={`Open ${row.name} in TUNE`} title={`Open ${row.name} in TUNE`} onclick={() => edit(row.out.id)}>»</button>
    </div>
  {/each}
</ModuleFrame>

<style>
  div.r.tbl {
    display: grid;
    grid-template-columns: 96px 64px 72px 44px 44px 56px 1fr;
    gap: 8px;
    font-family: var(--font-sans);
    font-size: 11px;
  }
  div.r.tbl.nolim { grid-template-columns: 96px 64px 72px 44px 1fr; }
  div.r.tbl.hd { color: var(--text-dim); }
  div.r.tbl.off { opacity: var(--dim-disabled); }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .num { text-align: right; }
  .tbl :global(.jump) { justify-self: end; }
</style>

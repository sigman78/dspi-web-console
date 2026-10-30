<script lang="ts">
  import EqSpectrum from '@/components/chrome/EqSpectrum.svelte';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import * as State from '@/state';
  import { reclaim } from '@/runtime/remote/lease';

  const { lease, serial }: { lease: State.Lease; serial: string } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => { now = Date.now(); }, 1000);
    return () => { clearInterval(t); };
  });

  const elapsed = $derived.by(() => {
    const s = Math.max(0, Math.floor((now - lease.since) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const mm = String(m).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  });
</script>

<div class="lent" role="status">
  <EqSpectrum />
  <div class="serial">{serial}</div>
  <div class="by">Under remote control by {lease.peerLabel}</div>
  <div class="time">{elapsed}</div>
  <ConfirmButton
    label="CANCEL"
    confirmLabel="TAKE BACK?"
    extraClass="hi md"
    tone="warn"
    title="Take the device back; the remote console is disconnected"
    onConfirm={() => { reclaim('cancel'); }}
  />
</div>

<style>
  .lent {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .serial {
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 2px;
    color: var(--text);
  }
  .by { font-size: 13px; color: var(--text-dim); }
  .time {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--text-faint);
  }
</style>

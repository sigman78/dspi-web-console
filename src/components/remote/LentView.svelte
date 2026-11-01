<script lang="ts">
  import EqSpectrum from '@/components/chrome/EqSpectrum.svelte';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import * as State from '@/state';
  import * as Share from '@/runtime/remote/share';

  const { lease, serial, hardware }: { lease: State.Lease; serial: string; hardware: string } = $props();

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
  <div class="device">
    <span class="serial">{serial}</span>
    <span class="hw">{hardware}</span>
  </div>
  <div class="by">Under remote control by {lease.peerLabel}</div>
  <div class="time">{elapsed}</div>
  {#if State.shareEnd() !== null}
    <div class="warn">Lost the relay; sharing ends with this session.</div>
  {/if}
  <div class="actions">
    <ConfirmButton
      label="CANCEL"
      confirmLabel="TAKE BACK?"
      extraClass="hi md"
      tone="warn"
      title="Take the device back; the other console can ask to return"
      onConfirm={() => { Share.cancelLend(); }}
    />
    <ConfirmButton
      label="STOP SHARING"
      confirmLabel="STOP?"
      extraClass="hi md"
      tone="danger"
      title="Take the device back and close the share"
      onConfirm={() => { Share.stopSharing(); }}
    />
  </div>
</div>

<style>
  .lent {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .device { display: flex; align-items: baseline; gap: 10px; }
  .serial {
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 2px;
    color: var(--text);
  }
  .hw {
    font-family: var(--font-mono);
    font-size: var(--fs-s);
    letter-spacing: 1px;
    color: var(--text-faint);
  }
  .by { font-size: 13px; color: var(--text-dim); }
  .time {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--text-faint);
  }
  .warn { font-size: var(--fs-m); color: var(--warn); }
  .actions { display: flex; align-items: center; gap: 10px; }
</style>

<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { setInputSource, setSpdifRxPin } from '@/runtime';
  import { AudioInputSource, SpdifInputState, availablePinsFor } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const inputConfig = $derived(snap?.inputConfig ?? null);
  const spdifStatus = $derived(s.telemetry.spdifRxStatus);
  const isSpdif = $derived(inputConfig?.source === AudioInputSource.Spdif);

  const STATE_LABELS: Record<number, string> = {
    [SpdifInputState.Inactive]:  'INACTIVE',
    [SpdifInputState.Acquiring]: 'ACQUIRING',
    [SpdifInputState.Locked]:    'LOCKED',
    [SpdifInputState.Relocking]: 'RELOCKING',
  };

  function stateTone(state: number): 'ok' | 'off' | undefined {
    if (state === SpdifInputState.Locked) return 'ok';
    if (state === SpdifInputState.Acquiring || state === SpdifInputState.Relocking) return undefined;
    return 'off';
  }

  function fmtRate(hz: number): string {
    return hz > 0 ? `${(hz / 1000).toFixed(1)} kHz` : '—';
  }
</script>

<Panel code="SY.11" title="INPUT CONFIG">
  {#if inputConfig !== null && snap !== null}
    <div class="kvgrid">
      <KV label="SOURCE" value={inputConfig.source === AudioInputSource.Spdif ? 'S/PDIF' : 'USB'} />
      <div class="src-btns">
        <button
          class="src"
          class:active={inputConfig.source === AudioInputSource.Usb}
          onclick={() => setInputSource(s, AudioInputSource.Usb)}
          disabled={!connected || inputConfig.source === AudioInputSource.Usb}
        >USB</button>
        <button
          class="src"
          class:active={inputConfig.source === AudioInputSource.Spdif}
          onclick={() => setInputSource(s, AudioInputSource.Spdif)}
          disabled={!connected || inputConfig.source === AudioInputSource.Spdif}
        >S/PDIF</button>
      </div>
    </div>

    <div class="subhdr">S/PDIF RX PIN</div>
    <div class="pinrow">
      <PinSelect
        value={inputConfig.spdifRxPin}
        candidates={availablePinsFor(snap.platform.type, snap, inputConfig.spdifRxPin)}
        ariaLabel="S/PDIF RX GPIO pin"
        disabled={!connected}
        onChange={(p) => setSpdifRxPin(s, p)}
      />
    </div>

    {#if isSpdif}
      <div class="subhdr">S/PDIF RX STATUS</div>
      {#if spdifStatus}
        <div class="kvgrid">
          <KV
            label="STATE"
            value={STATE_LABELS[spdifStatus.state] ?? 'UNKNOWN'}
            tone={stateTone(spdifStatus.state)}
          />
          <KV label="SAMPLE RATE" value={fmtRate(spdifStatus.sampleRate)} />
          <KV label="LOCK COUNT"  value={String(spdifStatus.lockCount)} />
          <KV label="LOSS COUNT"  value={String(spdifStatus.lossCount)} tone={spdifStatus.lossCount > 0 ? undefined : 'off'} />
          <KV label="PARITY ERR"  value={String(spdifStatus.parityErrors)} tone={spdifStatus.parityErrors > 0 ? undefined : 'off'} />
          <KV label="FIFO FILL"   value={`${spdifStatus.fifoFillPct}%`} />
        </div>
      {:else}
        <p class="idle">Waiting for S/PDIF status…</p>
      {/if}
    {/if}
  {:else}
    <p class="na">Not available on this firmware.</p>
  {/if}
</Panel>

<style>
  .kvgrid { padding: 10px 14px 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: center; }
  .src-btns { display: flex; gap: 4px; }
  .src {
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
  }
  .src:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .src:disabled { cursor: default; }
  .src.active {
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    border-color: color-mix(in oklab, var(--accent) 50%, var(--border));
    color: var(--accent);
    opacity: 1;
  }
  .subhdr {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--text-faint);
    padding: 6px 14px 0;
    border-top: 1px solid color-mix(in oklab, var(--text) 4%, transparent);
    margin-top: 4px;
  }
  .pinrow { padding: 6px 14px 6px; }
  .idle, .na { font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); padding: 8px 14px; margin: 0; }
</style>

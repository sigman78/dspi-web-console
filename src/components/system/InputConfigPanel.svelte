<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { setInputSource, setSpdifRxPin, setInputRate, setI2sRxPin, setI2sInputChannels } from '@/runtime';
  import { AudioInputSource, SpdifInputState, availablePinsFor, I2S_INPUT_RATES_HZ } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const inputConfig = $derived(snap?.inputConfig);
  const spdifStatus = $derived(s.telemetry.spdifRxStatus);
  const isSpdif = $derived(inputConfig?.source === AudioInputSource.Spdif);
  const isI2s = $derived(inputConfig?.source === AudioInputSource.I2s);
  const features = $derived(s.device.capabilities.features);
  // Configured count (0 = firmware default of 2); pairs 0..activePairs-1 show a pin select.
  const i2sChannels = $derived(inputConfig?.i2sInputChannels || 2);
  const i2sActivePairs = $derived(Math.max(1, Math.floor(i2sChannels / 2)));

  const SOURCE_LABELS: Record<number, string> = {
    [AudioInputSource.Usb]:   'USB',
    [AudioInputSource.Spdif]: 'S/PDIF',
    [AudioInputSource.I2s]:   'I2S',
  };

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
  {#if inputConfig && snap}
    <div class="cfgkvgrid">
      <KV label="SOURCE" value={SOURCE_LABELS[inputConfig.source] ?? 'USB'} />
      <div class="src-btns">
        <button
          class="chip"
          class:on={inputConfig.source === AudioInputSource.Usb}
          onclick={() => setInputSource(s, AudioInputSource.Usb)}
          disabled={!connected || inputConfig.source === AudioInputSource.Usb}
        >USB</button>
        <button
          class="chip"
          class:on={inputConfig.source === AudioInputSource.Spdif}
          onclick={() => setInputSource(s, AudioInputSource.Spdif)}
          disabled={!connected || inputConfig.source === AudioInputSource.Spdif}
        >S/PDIF</button>
        {#if features.i2sInput}
          <button
            class="chip"
            class:on={isI2s}
            onclick={() => setInputSource(s, AudioInputSource.I2s)}
            disabled={!connected || isI2s}
          >I2S</button>
        {/if}
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

    {#if features.i2sInput}
      <div class="subhdr">I2S INPUT</div>
      <div class="cfgkvgrid">
        <KV label="RATE" value={`${(inputConfig.i2sInputRateHz / 1000).toFixed(1)} kHz`} />
        <div class="src-btns">
          {#each I2S_INPUT_RATES_HZ as hz (hz)}
            <button
              class="chip"
              class:on={inputConfig.i2sInputRateHz === hz}
              onclick={() => setInputRate(s, hz)}
              disabled={!connected || inputConfig.i2sInputRateHz === hz}
            >{hz / 1000}k</button>
          {/each}
        </div>
        {#if features.multichannelInput}
          <KV label="CHANNELS" value={String(i2sChannels)} />
          <div class="src-btns">
            {#each [2, 4, 6, 8] as n (n)}
              <button
                class="chip"
                class:on={i2sChannels === n}
                onclick={() => setI2sInputChannels(s, n)}
                disabled={!connected || i2sChannels === n}
              >{n}</button>
            {/each}
          </div>
        {/if}
      </div>
      {#each Array.from({ length: i2sActivePairs }, (_, p) => p) as pair (pair)}
        <div class="subhdr">I2S RX PIN{i2sActivePairs > 1 ? ` · PAIR ${pair + 1}` : ''}</div>
        <div class="pinrow">
          <PinSelect
            value={inputConfig.i2sRxPins[pair] ?? 0}
            candidates={availablePinsFor(snap.platform.type, snap, inputConfig.i2sRxPins[pair] ?? 0)}
            ariaLabel={`I2S RX data pin, stereo pair ${pair + 1}`}
            disabled={!connected}
            onChange={(p) => setI2sRxPin(s, pair, p)}
          />
        </div>
      {/each}
    {/if}

    {#if isSpdif}
      <div class="subhdr">S/PDIF RX STATUS</div>
      {#if spdifStatus}
        <div class="cfgkvgrid">
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
        <p class="hint idle">Waiting for S/PDIF status…</p>
      {/if}
    {/if}
  {/if}
</Panel>

<style>
  .cfgkvgrid { padding: 10px 14px 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: center; }
  .src-btns { display: flex; gap: 4px; }
  .pinrow { padding: 6px 14px 6px; }
  .idle { padding: 10px 14px; }
</style>

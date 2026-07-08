<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { stageInputSource, stageSpdifRxPin, stageInputRate, stageI2sRxPin, stageI2sInputChannels } from '@/runtime';
  import { AudioInputSource, SpdifInputState, availablePinsFor, I2S_INPUT_RATES_HZ, liveCsPinConfigs } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const inputConfig = $derived(snap?.inputConfig);
  const spdifStatus = $derived(s.telemetry.spdifRxStatus);
  const liveSource = $derived(inputConfig?.source ?? AudioInputSource.Usb);
  const source = $derived(s.staging.valueOf('inputSource', liveSource));
  const sourcePending = $derived(source !== liveSource);
  const isSpdif = $derived(source === AudioInputSource.Spdif);
  const isI2s = $derived(source === AudioInputSource.I2s);
  const features = $derived(s.device.capabilities.features);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status) });
  const overlaySnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const effSpdifRxPin = $derived(inputConfig ? s.staging.valueOf('spdifRxPin', inputConfig.spdifRxPin) : 0);
  const effRate = $derived(inputConfig ? s.staging.valueOf('inputRate', inputConfig.i2sInputRateHz) : 0);
  // Configured count (0 = firmware default of 2); pairs 0..activePairs-1 show a pin select.
  const liveChannels = $derived(inputConfig?.i2sInputChannels || 2);
  const i2sChannels = $derived(s.staging.valueOf('i2sChannels', liveChannels));
  const i2sActivePairs = $derived(Math.max(1, Math.floor(i2sChannels / 2)));

  function effI2sRxPin(pair: number): number {
    return s.staging.valueOf(`i2sRxPin:${pair}`, inputConfig?.i2sRxPins[pair] ?? 0);
  }

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

  // Host-selected USB width (alt setting), live from telemetry. Only
  // meaningful while the device actually runs on USB, so a pending
  // source switch hides it rather than showing the old source's count.
  const usbDetected = $derived.by(() => {
    const n = s.telemetry.activeInputChannels;
    return n == null ? '—' : `${n} CH`;
  });
  const showUsbDetected = $derived(
    features.activeInputCount && liveSource === AudioInputSource.Usb,
  );
</script>

<Panel code="SY.11" title="INPUT CONFIG">
  {#if inputConfig && snap && overlaySnap}
    <div class="cfgkvgrid">
      <KV label="SOURCE" value={SOURCE_LABELS[source] ?? 'USB'} />
      <div class="src-btns">
        <button
          class="chip"
          class:on={source === AudioInputSource.Usb}
          class:staged={s.staging.has('inputSource') && source === AudioInputSource.Usb}
          onclick={() => stageInputSource(s, AudioInputSource.Usb)}
          disabled={!connected || source === AudioInputSource.Usb}
        >USB</button>
        <button
          class="chip"
          class:on={source === AudioInputSource.Spdif}
          class:staged={s.staging.has('inputSource') && source === AudioInputSource.Spdif}
          onclick={() => stageInputSource(s, AudioInputSource.Spdif)}
          disabled={!connected || source === AudioInputSource.Spdif}
        >S/PDIF</button>
        {#if features.i2sInput}
          <button
            class="chip"
            class:on={isI2s}
            class:staged={s.staging.has('inputSource') && isI2s}
            onclick={() => stageInputSource(s, AudioInputSource.I2s)}
            disabled={!connected || isI2s}
          >I2S</button>
        {/if}
      </div>
    </div>
    {#if sourcePending}
      <p class="hint pending">Device is running on {SOURCE_LABELS[liveSource]} — configuring pending {SOURCE_LABELS[source]}.</p>
    {/if}

    {#if source === AudioInputSource.Usb}
      {#if showUsbDetected}
        <div class="cfgkvgrid">
          <KV label="DETECTED" value={usbDetected} tone={s.telemetry.activeInputChannels == null ? 'off' : undefined} />
        </div>
      {/if}
      <p class="hint idle">USB input needs no configuration{features.activeInputCount ? ' — channel count follows the host' : ''}.</p>
    {/if}

    {#if isSpdif}
      <div class="subhdr">S/PDIF RX PIN</div>
      <div class="pinrow">
        <span class="stage-wrap" class:staged={s.staging.has('spdifRxPin')} title={s.staging.has('spdifRxPin') ? `device: GP${inputConfig.spdifRxPin}` : undefined}>
          <PinSelect
            value={effSpdifRxPin}
            candidates={availablePinsFor(snap.platform.type, overlaySnap, effSpdifRxPin, ctrlPins)}
            ariaLabel="S/PDIF RX GPIO pin"
            disabled={!connected}
            onChange={(p) => stageSpdifRxPin(s, p)}
          />
        </span>
      </div>

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

    {#if isI2s && features.i2sInput}
      <div class="subhdr">I2S INPUT</div>
      <div class="cfgkvgrid">
        <KV label="RATE" value={fmtRate(effRate)} />
        <div class="src-btns">
          {#each I2S_INPUT_RATES_HZ as hz (hz)}
            <button
              class="chip"
              class:on={effRate === hz}
              class:staged={s.staging.has('inputRate') && effRate === hz}
              onclick={() => stageInputRate(s, hz)}
              disabled={!connected || effRate === hz}
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
                class:staged={s.staging.has('i2sChannels') && i2sChannels === n}
                onclick={() => stageI2sInputChannels(s, n)}
                disabled={!connected || i2sChannels === n}
              >{n}</button>
            {/each}
          </div>
        {/if}
      </div>
      {#each Array.from({ length: i2sActivePairs }, (_, p) => p) as pair (pair)}
        <div class="subhdr">I2S RX PIN{i2sActivePairs > 1 ? ` · PAIR ${pair + 1}` : ''}</div>
        <div class="pinrow">
          <span class="stage-wrap" class:staged={s.staging.has(`i2sRxPin:${pair}`)} title={s.staging.has(`i2sRxPin:${pair}`) ? `device: GP${inputConfig.i2sRxPins[pair] ?? 0}` : undefined}>
            <PinSelect
              value={effI2sRxPin(pair)}
              candidates={availablePinsFor(snap.platform.type, overlaySnap, effI2sRxPin(pair), ctrlPins)}
              ariaLabel={`I2S RX data pin, stereo pair ${pair + 1}`}
              disabled={!connected}
              onChange={(p) => stageI2sRxPin(s, pair, p)}
            />
          </span>
        </div>
      {/each}
    {/if}
  {/if}
</Panel>

<style>
  .cfgkvgrid { padding: 10px 14px 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: center; }
  .src-btns { display: flex; gap: 4px; }
  .pinrow { padding: 6px 14px 6px; }
  .idle { padding: 10px 14px; }
  .pending { padding: 0 14px 8px; color: var(--accent); }
</style>

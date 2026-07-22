<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinSelect from './PinSelect.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { connection } from '@/state';
  import { stageInputSource, stageSpdifRxPin, stageSpdifRxPinExt, stageSpdifInputEnabled, stageInputRate, stageI2sRxPin, stageI2sInputChannels } from '@/runtime';
  import { AudioInputSource, isSpdifSource, SpdifInputState, I2sSlaveClockState, availablePinsFor, I2S_INPUT_RATES_HZ, liveCsPinConfigs } from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const inputConfig = $derived(snap?.inputConfig);
  const spdifStatus = $derived(s.telemetry.spdifRxStatus);
  const liveSource = $derived(inputConfig?.source ?? AudioInputSource.Usb);
  const source = $derived(s.staging.valueOf('inputSource', liveSource));
  const sourcePending = $derived(source !== liveSource);
  const isSpdif = $derived(isSpdifSource(source));
  const isI2s = $derived(source === AudioInputSource.I2s);
  const features = $derived(s.device.capabilities.features);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status) });
  const overlaySnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const effSpdifRxPin = $derived(inputConfig ? s.staging.valueOf('spdifRxPin', inputConfig.spdifRxPin) : 0);
  // Selectable S/PDIF inputs (1 unless the platform has the multi-SPDIF receiver, then 3).
  const spdifInputCount = $derived(s.device.capabilities.spdifInputCount);
  const effRate = $derived(inputConfig ? s.staging.valueOf('inputRate', inputConfig.i2sInputRateHz) : 0);
  // fw V21+: while the clock role is SLAVE, the external master owns the
  // rate -- the RATE row goes read-only (auto-detected) instead of the
  // firmware-applied selector below.
  const clockMode = $derived(inputConfig ? s.staging.valueOf('i2sClockMode', inputConfig.i2sClockMode) : 0);
  const slaveStatus = $derived(s.telemetry.i2sSlaveStatus);
  const showSlaveRate = $derived(Boolean(features.i2sSlaveClock) && clockMode === 1);
  const slaveRateLocked = $derived(slaveStatus?.state === I2sSlaveClockState.Locked);
  // Configured count (0 = firmware default of 2); pairs 0..activePairs-1 show a pin select.
  const liveChannels = $derived(inputConfig?.i2sInputChannels || 2);
  const i2sChannels = $derived(s.staging.valueOf('i2sChannels', liveChannels));
  const i2sActivePairs = $derived(Math.max(1, Math.floor(i2sChannels / 2)));

  function effI2sRxPin(pair: number): number {
    return s.staging.valueOf(`i2sRxPin:${pair}`, inputConfig?.i2sRxPins[pair] ?? 0);
  }

  function effSpdifExtEnabled(i: number): boolean {
    return s.staging.valueOf(`spdifEnable:${i}`, inputConfig?.spdifExtEnabled[i] ?? false);
  }

  function effSpdifRxPinExt(i: number): number {
    return s.staging.valueOf(`spdifRxPinExt:${i}`, inputConfig?.spdifRxPinExt[i] ?? 0);
  }

  // Unified per-input accessors over the S/PDIF rows: row 0 = input 1 (scalar,
  // always on), rows 1..2 = optional inputs (extIndex = i - 1).
  function spdifTitle(i: number): string {
    return i === 0 ? (spdifInputCount > 1 ? 'S/PDIF 1' : 'S/PDIF') : `S/PDIF ${i + 1}`;
  }
  function effSpdifPin(i: number): number {
    return i === 0 ? effSpdifRxPin : effSpdifRxPinExt(i - 1);
  }
  function devSpdifPin(i: number): number {
    return i === 0 ? (inputConfig?.spdifRxPin ?? 0) : (inputConfig?.spdifRxPinExt[i - 1] ?? 0);
  }
  function spdifPinKey(i: number): string {
    return i === 0 ? 'spdifRxPin' : `spdifRxPinExt:${i - 1}`;
  }
  function onSpdifPin(i: number, gpio: number): void {
    if (i === 0) stageSpdifRxPin(s, gpio);
    else stageSpdifRxPinExt(s, i - 1, gpio);
  }

  const SOURCE_LABELS = $derived<Record<number, string>>({
    [AudioInputSource.Usb]:    'USB',
    [AudioInputSource.Spdif]:  spdifInputCount > 1 ? 'S/PDIF 1' : 'S/PDIF',
    [AudioInputSource.Spdif2]: 'S/PDIF 2',
    [AudioInputSource.Spdif3]: 'S/PDIF 3',
    [AudioInputSource.I2s]:    'I2S',
  });

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
      <KV label="SOURCE" value={SOURCE_LABELS[liveSource] ?? 'USB'} />
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
        >{spdifInputCount > 1 ? 'S/P 1' : 'S/P'}</button>
        {#if features.multiSpdifInputs && inputConfig.spdifExtEnabled[0]}
          <button
            class="chip"
            class:on={source === AudioInputSource.Spdif2}
            class:staged={s.staging.has('inputSource') && source === AudioInputSource.Spdif2}
            onclick={() => stageInputSource(s, AudioInputSource.Spdif2)}
            disabled={!connected || source === AudioInputSource.Spdif2}
          >S/P 2</button>
        {/if}
        {#if features.multiSpdifInputs && inputConfig.spdifExtEnabled[1]}
          <button
            class="chip"
            class:on={source === AudioInputSource.Spdif3}
            class:staged={s.staging.has('inputSource') && source === AudioInputSource.Spdif3}
            onclick={() => stageInputSource(s, AudioInputSource.Spdif3)}
            disabled={!connected || source === AudioInputSource.Spdif3}
          >S/P 3</button>
        {/if}
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
      <div class="subhdr">S/PDIF RX</div>
      <div class="spdif-grid">
        {#each Array.from({ length: spdifInputCount }, (_, i) => i) as i (i)}
          <span class="spdif-title">{spdifTitle(i)}</span>
          <span class="spdif-toggle">
            {#if i === 0}
              <span class="dash" title="always enabled">—</span>
            {:else}
              <span class="stage-wrap" class:staged={s.staging.has(`spdifEnable:${i - 1}`)} title={s.staging.has(`spdifEnable:${i - 1}`) ? `device: ${inputConfig.spdifExtEnabled[i - 1] ? 'ON' : 'OFF'}` : undefined}>
                <ToggleSwitch
                  size="sm"
                  checked={effSpdifExtEnabled(i - 1)}
                  disabled={!connected}
                  ariaLabel={effSpdifExtEnabled(i - 1) ? `Disable ${spdifTitle(i)} input` : `Enable ${spdifTitle(i)} input`}
                  onChange={() => stageSpdifInputEnabled(s, i - 1, !effSpdifExtEnabled(i - 1))}
                />
              </span>
            {/if}
          </span>
          <span class="stage-wrap" class:staged={s.staging.has(spdifPinKey(i))} title={s.staging.has(spdifPinKey(i)) ? `device: GP${devSpdifPin(i)}` : undefined}>
            <PinSelect
              value={effSpdifPin(i)}
              candidates={availablePinsFor(snap.platform.type, overlaySnap, effSpdifPin(i), ctrlPins)}
              ariaLabel={`${spdifTitle(i)} RX GPIO pin`}
              disabled={!connected}
              allowReset={features.pinResetDefault}
              onChange={(p) => onSpdifPin(i, p)}
            />
          </span>
        {/each}
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
        {#if showSlaveRate}
          <KV
            label="RATE"
            value={slaveRateLocked ? fmtRate(slaveStatus?.detectedRateHz ?? 0) : '—'}
            tone={slaveRateLocked ? 'ok' : 'off'}
            title="Slave clock mode: rate follows the external I2S master"
          />
          <p class="hint">auto-detected — external master sets the rate</p>
        {:else}
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
        {/if}
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
              allowReset={features.pinResetDefault}
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
  .src-btns button { white-space: nowrap; }
  .pinrow { padding: 6px 14px 6px; }
  .idle { padding: 10px 14px; }
  .pending { padding: 0 14px 8px; color: var(--accent); }
  /* S/PDIF inputs: one row per selectable input -- title | toggle | pin --
     spread across the panel width (title at left, pin at the right edge). */
  .spdif-grid { padding: 8px 14px 4px; display: grid; grid-template-columns: auto auto auto; justify-content: space-between; row-gap: 12px; column-gap: 12px; align-items: center; }
  .spdif-title { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--text-dim); white-space: nowrap; }
  .spdif-toggle { display: flex; align-items: center; justify-content: center; min-width: 34px; }
  .dash { color: var(--text-faint); }
</style>

<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import PinPicker from '@/components/chrome/PinPicker.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import SourceNamesPopover from './SourceNamesPopover.svelte';
  import * as Runtime from '@/runtime';
  import * as Domain from '@/domain';
  import { Wire } from '@/protocol';
  import { formatRateKHz } from '@/utils';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const inputConfig = $derived(snap?.inputConfig);
  const spdifStatus = $derived(s.telemetry.spdifRxStatus);
  const liveSource = $derived(inputConfig?.source ?? Domain.AudioInputSource.Usb);
  const source = $derived(s.staging.valueOf('inputSource', liveSource));
  const sourcePending = $derived(source !== liveSource);
  const isSpdif = $derived(Domain.isSpdifSource(source));
  const isI2s = $derived(source === Domain.AudioInputSource.I2s);
  const features = $derived(s.device.capabilities.features);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: Domain.liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status) });
  const overlaySnap = $derived(snap ? s.staging.overlaySnapshot(snap) : null);
  const effSpdifRxPin = $derived(inputConfig ? s.staging.valueOf('spdifRxPin', inputConfig.spdifRxPin) : 0);
  const spdifInputCount = $derived(s.device.capabilities.spdifInputCount);
  const effRate = $derived(inputConfig ? s.staging.valueOf('inputRate', inputConfig.i2sInputRateHz) : 0);
  // While the clock role is SLAVE, the external master owns the rate: the
  // RATE row goes read-only (auto-detected) instead of the selector.
  const clockMode = $derived(inputConfig ? s.staging.valueOf('i2sClockMode', inputConfig.i2sClockMode) : 0);
  const slaveStatus = $derived(s.telemetry.i2sSlaveStatus);
  const showSlaveRate = $derived(clockMode === 1);
  const slaveRateLocked = $derived(slaveStatus?.state === Domain.I2sSlaveClockState.Locked);
  // Configured count (0 = firmware default of 2); one pin per stereo pair.
  const liveChannels = $derived(inputConfig?.i2sInputChannels || 2);
  const i2sChannels = $derived(s.staging.valueOf('i2sChannels', liveChannels));
  const i2sPairs = $derived(Math.max(1, Math.floor(i2sChannels / 2)));

  function effI2sRxPin(pair: number): number {
    return s.staging.valueOf(`i2sRxPin:${pair}`, inputConfig?.i2sRxPins[pair] ?? 0);
  }

  const effSpdifBlock = $derived(inputConfig ? s.staging.valueOf('spdifBlock', inputConfig.spdifEnabled) : false);
  const effI2sBlock = $derived(inputConfig ? s.staging.valueOf('i2sBlock', inputConfig.i2sEnabled) : false);
  const effSpdifCount = $derived(inputConfig ? s.staging.valueOf('spdifCount', inputConfig.spdifCount) : 1);
  // A staged count closes the holes a gappy 1.1.6 mask leaves.
  const effSpdifHoles = $derived(s.staging.has('spdifCount') ? 0 : (inputConfig?.spdifHoles ?? 0));

  const SPDIF_SOURCES = [
    Domain.AudioInputSource.Spdif, Domain.AudioInputSource.Spdif2,
    Domain.AudioInputSource.Spdif3, Domain.AudioInputSource.Spdif4,
  ] as const;
  const spdifIndexes = $derived(Array.from({ length: Math.min(spdifInputCount, SPDIF_SOURCES.length) }, (_, i) => i));

  const spdifOn = (i: number): boolean => effSpdifBlock && i < effSpdifCount && ((effSpdifHoles >> i) & 1) === 0;
  const spdifLiveOn = (i: number): boolean => !!inputConfig && Domain.spdifInputOn(inputConfig, i);
  // Inputs up to the live or staged S/PDIF source must stay on.
  const spdifLockedUpTo = $derived(Math.max(Domain.spdifIndexOf(liveSource), Domain.spdifIndexOf(source)));
  const i2sLocked = $derived(liveSource === Domain.AudioInputSource.I2s || source === Domain.AudioInputSource.I2s);
  // Firmware without block switches has no switch on S/PDIF 1 or I2S.
  const spdifHasSwitch = (i: number): boolean => i > 0 || features.inputBlocks;
  // ADAT shows only while it is in play (switched on, or the source); its
  // radio needs a pin unless it already is the source.
  const showAdatRow = $derived((features.adatInput && !!inputConfig && Domain.adatInputInUse(inputConfig)) || source === Domain.AudioInputSource.Adat);
  const showOnCol = $derived(features.inputBlocks || spdifInputCount > 1 || showAdatRow);
  const adatPin = $derived(inputConfig ? s.staging.valueOf('adatInputPin', inputConfig.adatInputPin) : 0);
  const adatPickable = $derived(adatPin !== 0 || source === Domain.AudioInputSource.Adat);
  const effAdatEnabled = $derived(inputConfig ? s.staging.valueOf('adatInputEnable', inputConfig.adatInputEnabled) : false);
  const adatLocked = $derived(liveSource === Domain.AudioInputSource.Adat || source === Domain.AudioInputSource.Adat);
  const adatClockMode = $derived(inputConfig?.adatInputClockMode ?? 0);
  const adatStatus = $derived(s.telemetry.adatInputStatus);
  function spdifLockReason(i: number): string {
    return i === Domain.spdifIndexOf(liveSource) || i === Domain.spdifIndexOf(source) ? 'In use as the source' : 'Inputs up to the source stay on';
  }

  function effSpdifPin(i: number): number {
    return i === 0 ? effSpdifRxPin : s.staging.valueOf(`spdifRxPinExt:${i - 1}`, inputConfig?.spdifRxPinExt[i - 1] ?? 0);
  }
  function devSpdifPin(i: number): number {
    return i === 0 ? (inputConfig?.spdifRxPin ?? 0) : (inputConfig?.spdifRxPinExt[i - 1] ?? 0);
  }
  function spdifPinKey(i: number): string {
    return i === 0 ? 'spdifRxPin' : `spdifRxPinExt:${i - 1}`;
  }
  function onSpdifPin(i: number, gpio: number): void {
    if (i === 0) Runtime.stageSpdifRxPin(s, gpio);
    else Runtime.stageSpdifRxPinExt(s, i - 1, gpio);
  }

  function spdifPinCells(i: number): Domain.PinPickerCell[] {
    if (!snap || !overlaySnap) return [];
    const cells = Domain.pickerCells(snap.platform.type, overlaySnap, ctrlPins, effSpdifPin(i));
    if (i === 0) return cells;
    // ext inputs: GP0 on the wire means "not configured" -- keep it visible but unpickable.
    return cells.map((c) => (c.pin === 0 ? { ...c, selectable: false, reason: 'reserved as the UNSET sentinel' } : c));
  }

  // The reset covers the visible pickers of the source's block only; an ext
  // S/PDIF input still at the unset sentinel is skipped, as a reset would
  // materialize a GPIO with no way back to UNSET.
  const resetBlock = $derived(isSpdif ? 'S/PDIF' : isI2s ? 'I2S' : null);
  function stagePinsToDefault(): void {
    if (isSpdif) {
      for (const i of spdifIndexes) {
        if (!spdifOn(i) || (i > 0 && effSpdifPin(i) === 0)) continue;
        onSpdifPin(i, Wire.Const.PIN_RESET_TO_DEFAULT);
      }
    } else if (isI2s && effI2sBlock) {
      for (let pair = 0; pair < i2sPairs; pair++) Runtime.stageI2sRxPin(s, pair, Wire.Const.PIN_RESET_TO_DEFAULT);
    }
  }

  const uid = $props.id();
  const namesBtnId = `names-btn-${uid}`;
  const namesPopId = `names-pop-${uid}`;
  let namesOpen = $state(false);
  const namesAvailable = $derived(!!(inputConfig && snap && overlaySnap) && s.names.inputSourcesSupported === true);
  $effect(() => { if (!namesAvailable) namesOpen = false; });

  const sourceTitle = (src: number): string => Domain.inputSourceTitle(src, s.names.inputSources, true);

  const STATE_LABELS: Record<number, string> = {
    [Domain.SpdifInputState.Inactive]:  'INACTIVE',
    [Domain.SpdifInputState.Acquiring]: 'ACQUIRING',
    [Domain.SpdifInputState.Locked]:    'LOCKED',
    [Domain.SpdifInputState.Relocking]: 'RELOCKING',
  };

  function stateTone(state: number): 'ok' | 'off' | undefined {
    if (state === Domain.SpdifInputState.Locked) return 'ok';
    if (state === Domain.SpdifInputState.Acquiring || state === Domain.SpdifInputState.Relocking) return undefined;
    return 'off';
  }

  // Host-selected USB width (alt setting), live from telemetry. Only
  // meaningful while the device actually runs on USB, so a pending
  // source switch hides it rather than showing the old source's count.
  const usbDetected = $derived.by(() => {
    const n = s.telemetry.activeInputChannels;
    return n == null ? '—' : `${n} CH`;
  });
</script>

<Panel title="INPUT CONFIG">
  {#snippet right()}
    {#if s.names.inputSourcesSupported === true}
      <button id={namesBtnId} class="chip icon" aria-haspopup="dialog" aria-controls={namesPopId} title="Rename input sources" aria-label="Rename input sources" aria-expanded={namesOpen} onclick={() => { namesOpen = !namesOpen; }}>✎</button>
    {/if}
    {#if resetBlock}
      <button class="chip icon" title={`Reset ${resetBlock} pins to defaults`} aria-label="Reset input pins to defaults" onclick={stagePinsToDefault}>↺</button>
    {/if}
  {/snippet}
  {#if inputConfig && snap && overlaySnap}
    {#if namesOpen && s.names.inputSourcesSupported === true}
      <SourceNamesPopover id={namesPopId} ignore={`#${namesBtnId}`} onClose={() => { namesOpen = false; }} />
    {/if}

    {#snippet radio(src: Domain.AudioInputSource)}
      {@const checked = src === source}
      <button
        type="button"
        role="radio"
        class="radio"
        class:on={checked}
        class:staged={checked && sourcePending}
        aria-checked={checked}
        aria-label={sourceTitle(src)}
        title={sourceTitle(src)}
        onclick={() => Runtime.stageInputSource(s, src)}
      ></button>
    {/snippet}

    {#snippet nameBtn(src: Domain.AudioInputSource)}
      <button type="button" class="name" tabindex="-1" title={sourceTitle(src)} onclick={() => Runtime.stageInputSource(s, src)}>{sourceTitle(src)}</button>
    {/snippet}

    {#snippet toggle(name: string, on: boolean, liveOn: boolean, locked: boolean, reason: string, onChange: (v: boolean) => void)}
      <span class="stage-wrap" class:staged={on !== liveOn} title={on !== liveOn ? `device: ${liveOn ? 'ON' : 'OFF'}` : undefined}>
        <ToggleSwitch checked={on} disabled={locked} disabledReason={reason} ariaLabel={`Switch ${name} ${on ? 'off' : 'on'}`} {onChange} />
      </span>
    {/snippet}

    <div class="lhdr">
      <span class="microlbl src">SOURCE</span>
      <span class="microlbl">{#if showOnCol}ON{/if}</span>
      <span class="microlbl">PIN</span>
      {#if effI2sBlock && features.multichannelInput}<span class="microlbl">CH</span>{/if}
    </div>
    <div class="list" role="radiogroup" aria-label="Input source">
      <div class="lrow" class:hot={source === Domain.AudioInputSource.Usb}>
        <span class="c">{@render radio(Domain.AudioInputSource.Usb)}</span>
        {@render nameBtn(Domain.AudioInputSource.Usb)}
        <span></span><span></span>
      </div>

      {#each spdifIndexes as i (i)}
        {@const src = SPDIF_SOURCES[i]}
        <div class="lrow" class:hot={src === source}>
          <span class="c">{@render radio(src)}</span>
          {@render nameBtn(src)}
          <span class="c">
            {#if spdifHasSwitch(i)}
              {@render toggle(sourceTitle(src), spdifOn(i), spdifLiveOn(i), spdifOn(i) && i <= spdifLockedUpTo, spdifLockReason(i), (v) => Runtime.stageSpdifInputOn(s, i, v))}
            {/if}
          </span>
          <span class="c">
            {#if spdifOn(i)}
              <span class="stage-wrap" class:staged={s.staging.has(spdifPinKey(i))} title={s.staging.has(spdifPinKey(i)) ? `device: GP${devSpdifPin(i)}` : undefined}>
                <PinPicker
                  value={effSpdifPin(i)}
                  cells={spdifPinCells(i)}
                  placeholder={i === 0 ? undefined : 'UNSET'}
                  ariaLabel={`${sourceTitle(src)} RX GPIO pin`}
                  onChange={(p) => onSpdifPin(i, p)}
                />
              </span>
            {/if}
          </span>
        </div>
      {/each}

      <div class="lrow" class:hot={isI2s}>
        <span class="c">{@render radio(Domain.AudioInputSource.I2s)}</span>
        {@render nameBtn(Domain.AudioInputSource.I2s)}
        <span class="c">
          {#if features.inputBlocks}
            {@render toggle(sourceTitle(Domain.AudioInputSource.I2s), effI2sBlock, inputConfig.i2sEnabled, i2sLocked, 'In use as the source', (v) => Runtime.stageI2sInputEnabled(s, v))}
          {/if}
        </span>
        <span class="c">
          {#if effI2sBlock}
            <span class="stage-wrap" class:staged={s.staging.has('i2sRxPin:0')} title={s.staging.has('i2sRxPin:0') ? `device: GP${inputConfig.i2sRxPins[0] ?? 0}` : undefined}>
              <PinPicker
                value={effI2sRxPin(0)}
                cells={Domain.pickerCells(snap.platform.type, overlaySnap, ctrlPins, effI2sRxPin(0))}
                ariaLabel="I2S RX data pin, stereo pair 1"
                onChange={(p) => Runtime.stageI2sRxPin(s, 0, p)}
              />
            </span>
          {/if}
        </span>
        <span class="c">
          {#if effI2sBlock && features.multichannelInput}
            <span class="chips" role="group" aria-label="I2S input channels">
              {#each [2, 4, 6, 8] as n (n)}
                <button
                  class="chip"
                  class:on={i2sChannels === n}
                  class:staged={s.staging.has('i2sChannels') && i2sChannels === n}
                  aria-label={`I2S ${n} channels`}
                  onclick={() => Runtime.stageI2sInputChannels(s, n)}
                  disabled={i2sChannels === n}
                >{n}</button>
              {/each}
            </span>
          {/if}
        </span>
      </div>

      {#if effI2sBlock}
        {#each Array.from({ length: i2sPairs - 1 }, (_, k) => k + 1) as pair (pair)}
          <div class="lrow">
            <span></span>
            <span class="name sub">Pair {pair + 1}</span>
            <span></span>
            <span class="c">
              <span class="stage-wrap" class:staged={s.staging.has(`i2sRxPin:${pair}`)} title={s.staging.has(`i2sRxPin:${pair}`) ? `device: GP${inputConfig.i2sRxPins[pair] ?? 0}` : undefined}>
                <PinPicker
                  value={effI2sRxPin(pair)}
                  cells={Domain.pickerCells(snap.platform.type, overlaySnap, ctrlPins, effI2sRxPin(pair))}
                  ariaLabel={`I2S RX data pin, stereo pair ${pair + 1}`}
                  onChange={(p) => Runtime.stageI2sRxPin(s, pair, p)}
                />
              </span>
            </span>
          </div>
        {/each}
      {/if}

      {#if showAdatRow}
        <div class="lrow" class:hot={source === Domain.AudioInputSource.Adat}>
          <span class="c">{#if adatPickable}{@render radio(Domain.AudioInputSource.Adat)}{/if}</span>
          {#if adatPickable}
            {@render nameBtn(Domain.AudioInputSource.Adat)}
          {:else}
            <span class="name" title={sourceTitle(Domain.AudioInputSource.Adat)}>{sourceTitle(Domain.AudioInputSource.Adat)}</span>
          {/if}
          <span class="c">
            {@render toggle(sourceTitle(Domain.AudioInputSource.Adat), effAdatEnabled, inputConfig.adatInputEnabled, adatLocked, 'In use as the source', (v) => Runtime.stageAdatInputEnabled(s, v))}
          </span>
          <span></span>
        </div>
      {/if}
    </div>

    {#if source === Domain.AudioInputSource.Usb}
      <div class="subhdr">USB</div>
      {#if sourcePending}
        <p class="hint idle">Status appears after APPLY.</p>
      {:else}
        <div class="kvrows">
          <KV inline label="DETECTED" value={usbDetected} tone={s.telemetry.activeInputChannels == null ? 'off' : undefined} />
        </div>
      {/if}
    {/if}

    {#if isSpdif}
      <div class="subhdr">{sourceTitle(source)} STATUS</div>
      {#if sourcePending}
        <p class="hint idle">Status appears after APPLY.</p>
      {:else if spdifStatus}
        <div class="kvrows">
          <KV inline label="STATE" value={STATE_LABELS[spdifStatus.state] ?? 'UNKNOWN'} tone={stateTone(spdifStatus.state)} />
          <KV inline label="SAMPLE RATE" value={formatRateKHz(spdifStatus.sampleRate)} />
          <KV inline label="LOCK COUNT" value={String(spdifStatus.lockCount)} />
          <KV inline label="LOSS COUNT" value={String(spdifStatus.lossCount)} tone={spdifStatus.lossCount > 0 ? undefined : 'off'} />
          <KV inline label="PARITY ERR" value={String(spdifStatus.parityErrors)} tone={spdifStatus.parityErrors > 0 ? undefined : 'off'} />
          <KV inline label="FIFO FILL" value={`${spdifStatus.fifoFillPct}%`} />
        </div>
      {:else}
        <p class="hint idle">Waiting for S/PDIF status…</p>
      {/if}
    {/if}

    {#if isI2s}
      <div class="subhdr">I2S INPUT</div>
      {#if showSlaveRate}
        <div class="kvrows">
          <KV
            inline
            label="RATE"
            value={slaveRateLocked ? formatRateKHz(slaveStatus?.detectedRateHz ?? 0) : '—'}
            tone={slaveRateLocked ? 'ok' : 'off'}
            title="Slave clock mode: rate follows the external I2S master"
          />
        </div>
        <p class="hint idle">auto-detected — external master sets the rate</p>
      {:else}
        <div class="ctl">
          <span class="microlbl">RATE</span>
          <span class="chips">
            {#each Domain.I2S_INPUT_RATES_HZ as hz (hz)}
              <button
                class="chip"
                class:on={effRate === hz}
                class:staged={s.staging.has('inputRate') && effRate === hz}
                onclick={() => Runtime.stageInputRate(s, hz)}
                disabled={effRate === hz}
              >{hz / 1000}k</button>
            {/each}
          </span>
        </div>
      {/if}
    {/if}

    {#if source === Domain.AudioInputSource.Adat}
      <div class="subhdr">ADAT INPUT</div>
      {#if adatClockMode === 1}
        <div class="kvrows">
          <KV
            inline
            label="RATE"
            value={adatStatus?.state === Domain.AdatInputLockState.Locked ? formatRateKHz(adatStatus.detectedRateHz) : '—'}
            tone={adatStatus?.state === Domain.AdatInputLockState.Locked ? 'ok' : 'off'}
            title="Slave clock mode: rate follows the external ADAT master"
          />
        </div>
        <p class="hint idle">auto-detected — external master sets the rate</p>
      {:else}
        <div class="ctl">
          <span class="microlbl">RATE</span>
          <span class="chips">
            {#each Domain.I2S_INPUT_RATES_HZ as hz (hz)}
              <button
                class="chip"
                class:on={effRate === hz}
                class:staged={s.staging.has('inputRate') && effRate === hz}
                onclick={() => Runtime.stageInputRate(s, hz)}
                disabled={effRate === hz || hz > 48000}
                title={hz > 48000 ? 'ADAT runs at 44.1/48 kHz only — higher rates park the input' : undefined}
              >{hz / 1000}k</button>
            {/each}
          </span>
        </div>
        {#if adatStatus?.rateOk === false}
          <p class="hint warn idle">PARKED — device rate above 48 kHz</p>
        {/if}
      {/if}
    {/if}
  {/if}
</Panel>

<style>
  .kvrows { padding: 4px 0; }
  .idle { padding: 10px 14px; }
  .hint.warn { color: var(--warn); }
  .list { display: flex; flex-direction: column; }
  .lhdr, .lrow { display: grid; grid-template-columns: 16px 76px 26px 70px auto; column-gap: 10px; align-items: center; padding: 0 14px; }
  .lhdr { height: 22px; }
  .lhdr .microlbl { color: var(--text-faint); }
  .lhdr .src { grid-column: 1 / span 2; }
  .lrow { height: 26px; border-top: 1px solid var(--wash); }
  .lrow.hot { background: var(--wash); }
  .c { display: inline-flex; align-items: center; min-width: 0; }
  .name { font-family: var(--font-sans); font-size: var(--fs-m); color: var(--text-dim); background: none; border: none; padding: 0; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  button.name { cursor: pointer; }
  .lrow.hot .name { color: var(--text); font-weight: 500; }
  .name.sub { padding-left: 10px; color: var(--text-faint); }
  .radio { width: 16px; height: 16px; box-sizing: border-box; padding: 0; border-radius: 50%; border: 1px solid var(--border-hi); background: none; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .radio:hover { border-color: var(--text-dim); }
  .radio.on { border-color: var(--accent); }
  .radio.on::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  .ctl { display: grid; grid-template-columns: 102px auto; justify-content: start; align-items: center; min-height: 28px; padding: 0 14px; }
  .chips { display: inline-flex; gap: 4px; }
</style>

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
  // Selectable S/PDIF inputs (1 unless the platform has the multi-SPDIF receiver, then 4).
  const spdifInputCount = $derived(s.device.capabilities.spdifInputCount);
  const effRate = $derived(inputConfig ? s.staging.valueOf('inputRate', inputConfig.i2sInputRateHz) : 0);
  // While the clock role is SLAVE, the external master owns the
  // rate -- the RATE row goes read-only (auto-detected) instead of the
  // firmware-applied selector below.
  const clockMode = $derived(inputConfig ? s.staging.valueOf('i2sClockMode', inputConfig.i2sClockMode) : 0);
  const slaveStatus = $derived(s.telemetry.i2sSlaveStatus);
  const showSlaveRate = $derived(clockMode === 1);
  const slaveRateLocked = $derived(slaveStatus?.state === Domain.I2sSlaveClockState.Locked);
  // ADAT input's clock mode/status are read live here (its panel owns the
  // write path).
  const adatClockMode = $derived(inputConfig?.adatInputClockMode ?? 0);
  const adatStatus = $derived(s.telemetry.adatInputStatus);
  // Configured count (0 = firmware default of 2); pairs 0..activePairs-1 show a pin select.
  const liveChannels = $derived(inputConfig?.i2sInputChannels || 2);
  const i2sChannels = $derived(s.staging.valueOf('i2sChannels', liveChannels));
  const i2sActivePairs = $derived(Math.max(1, Math.floor(i2sChannels / 2)));

  function effI2sRxPin(pair: number): number {
    return s.staging.valueOf(`i2sRxPin:${pair}`, inputConfig?.i2sRxPins[pair] ?? 0);
  }

  // Block switches and the S/PDIF count, with staged values applied.
  const effSpdifBlock = $derived(inputConfig ? s.staging.valueOf('spdifBlock', inputConfig.spdifEnabled) : false);
  const effI2sBlock = $derived(inputConfig ? s.staging.valueOf('i2sBlock', inputConfig.i2sEnabled) : false);
  const effAdatEnabled = $derived(inputConfig ? s.staging.valueOf('adatInputEnable', inputConfig.adatInputEnabled) : false);
  const effAdatPin = $derived(inputConfig ? s.staging.valueOf('adatInputPin', inputConfig.adatInputPin) : 0);
  const liveSpdifCount = $derived(inputConfig?.spdifCount ?? 1);
  const effSpdifCount = $derived(inputConfig ? s.staging.valueOf('spdifCount', inputConfig.spdifCount) : 1);
  const multiSpdif = $derived(spdifInputCount > 1);
  // S/PDIF input rows shown: the single-receiver platform has no count.
  const spdifRows = $derived(multiSpdif ? effSpdifCount : 1);
  // Radios cover every input in the live or the staged count; cut ones show as ghosts.
  // The staged source always keeps its radio, even beyond the count.
  const spdifRadios = $derived(multiSpdif ? Math.max(effSpdifCount, liveSpdifCount, Domain.spdifIndexOf(source) + 1) : 1);

  const SPDIF_SOURCES = [
    Domain.AudioInputSource.Spdif, Domain.AudioInputSource.Spdif2,
    Domain.AudioInputSource.Spdif3, Domain.AudioInputSource.Spdif4,
  ] as const;

  type RadioLook = 'idle' | 'live' | 'leaving' | 'target' | 'added' | 'removed';
  // The look of one source radio; `k` is the S/PDIF input index, else -1.
  function radioLook(src: Domain.AudioInputSource, k: number): RadioLook {
    if (sourcePending && src === source) return 'target';
    if (k >= liveSpdifCount && k < effSpdifCount) return 'added';
    if (k >= effSpdifCount && k < liveSpdifCount) return 'removed';
    if (src === liveSource) return sourcePending ? 'leaving' : 'live';
    return 'idle';
  }
  function onRadio(src: Domain.AudioInputSource, k: number): void {
    if (k >= effSpdifCount) Runtime.stageSpdifInputCount(s, k + 1);
    else Runtime.stageInputSource(s, src);
  }

  // The block a source lives in, for the pins cell.
  type Block = 'usb' | 'spdif' | 'i2s' | 'adat';
  function blockOf(src: number): Block {
    if (src === Domain.AudioInputSource.Usb) return 'usb';
    if (src === Domain.AudioInputSource.I2s) return 'i2s';
    if (src === Domain.AudioInputSource.Adat) return 'adat';
    return 'spdif';
  }
  const blockLive = $derived(blockOf(liveSource));
  const blockStaged = $derived(sourcePending ? blockOf(source) : null);
  const blockStagedOn = $derived({
    usb: false,
    spdif: s.staging.has('spdifBlock') && effSpdifBlock,
    i2s: s.staging.has('i2sBlock') && effI2sBlock,
    adat: s.staging.has('adatInputEnable') && effAdatEnabled,
  });

  // The highest S/PDIF input is the live or the staged source: it cannot be removed.
  const highestHeld = $derived(
    Domain.spdifIndexOf(liveSource) === effSpdifCount - 1 || Domain.spdifIndexOf(source) === effSpdifCount - 1,
  );

  // A custom name rides the sub-header of its section.
  function subTitle(base: string, src: number): string {
    const custom = s.names.inputSources?.[src];
    return custom ? `${base} · "${custom}"` : base;
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

  // Only the section currently shown gets reset -- the hidden section's
  // pickers aren't rendered, so their targets can't be staged from here.
  function stageSectionPinsToDefault(): void {
    if (isSpdif) {
      for (let i = 0; i < spdifRows; i++) {
        // An ext input still at the unset sentinel is skipped: resetting it
        // would materialize a GPIO with no way back to UNSET.
        if (i > 0 && effSpdifPin(i) === 0) continue;
        onSpdifPin(i, Wire.Const.PIN_RESET_TO_DEFAULT);
      }
    } else if (isI2s) {
      for (let pair = 0; pair < i2sActivePairs; pair++) Runtime.stageI2sRxPin(s, pair, Wire.Const.PIN_RESET_TO_DEFAULT);
    }
  }

  const uid = $props.id();
  const namesBtnId = `names-btn-${uid}`;
  const namesPopId = `names-pop-${uid}`;
  let namesOpen = $state(false);
  const namesAvailable = $derived(!!(inputConfig && snap && overlaySnap) && s.names.inputSourcesSupported === true);
  $effect(() => { if (!namesAvailable) namesOpen = false; });

  // Radio names number S/PDIF inputs whenever the platform has several, as the pin rows do.
  const radioTitle = (src: number): string => Domain.inputSourceTitle(src, s.names.inputSources, multiSpdif);
  const sourceTitle = (src: number): string => Domain.inputSourceTitle(src, s.names.inputSources, Domain.spdifNumbered(inputConfig));

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
  const showUsbDetected = $derived(liveSource === Domain.AudioInputSource.Usb);
</script>

<Panel title="INPUT CONFIG">
  {#snippet right()}
    {#if s.names.inputSourcesSupported === true}
      <button id={namesBtnId} class="chip icon" aria-haspopup="dialog" aria-controls={namesPopId} title="Rename input sources" aria-label="Rename input sources" aria-expanded={namesOpen} onclick={() => { namesOpen = !namesOpen; }}>✎</button>
    {/if}
    {#if isSpdif || isI2s}
      <button class="chip icon" title="Reset to defaults" aria-label="Reset input pins to defaults" onclick={stageSectionPinsToDefault}>↺</button>
    {/if}
  {/snippet}
  {#if inputConfig && snap && overlaySnap}
    <div class="srcrow">
      {#if namesOpen && s.names.inputSourcesSupported === true}
        <SourceNamesPopover id={namesPopId} ignore={`#${namesBtnId}`} onClose={() => { namesOpen = false; }} />
      {/if}
      <div class="list" role="radiogroup" aria-label="Input source">
        <div class="lhdr"><span class="microlbl">SOURCE</span><span class="microlbl">PINS</span></div>

        {#snippet radio(src: Domain.AudioInputSource, k: number, digit: string)}
          {@const look = radioLook(src, k)}
          <button
            type="button"
            role="radio"
            class="radio {look}"
            class:dot={digit === ''}
            class:staged={look === 'target' || look === 'added' || look === 'removed'}
            aria-checked={source === src && look !== 'removed'}
            aria-label={look === 'removed' ? `Restore ${radioTitle(src)}` : radioTitle(src)}
            title={look === 'removed' ? `Restore ${radioTitle(src)}` : radioTitle(src)}
            onclick={() => onRadio(src, k)}
          >{digit}</button>
        {/snippet}

        {#snippet pinsCell(block: Block)}
          {#if block === 'usb'}
            <span class="tag faint">—</span>
          {:else if blockLive === block}
            <span class="tag ok">IN USE</span>
          {:else if blockStaged === block}
            <span class="tag warn" title={blockStagedOn[block] ? 'device: OFF, switches on with apply' : undefined}>PENDING</span>
          {:else if block === 'adat' && effAdatPin === 0 && !s.staging.has('adatInputEnable')}
            <span class="tag faint" title="Assign a pin in ADAT INPUT">NO PIN</span>
          {:else if block !== 'adat' && !features.inputBlocks}
            <span class="tag faint">ALWAYS</span>
          {:else if block === 'spdif'}
            <span class="stage-wrap" class:staged={s.staging.has('spdifBlock')} title={s.staging.has('spdifBlock') ? `device: ${inputConfig!.spdifEnabled ? 'ON' : 'OFF'}` : undefined}>
              <ToggleSwitch checked={effSpdifBlock} ariaLabel={effSpdifBlock ? 'Switch S/PDIF inputs off' : 'Switch S/PDIF inputs on'} onChange={(v) => Runtime.stageSpdifBlockEnabled(s, v)} />
            </span>
          {:else if block === 'i2s'}
            <span class="stage-wrap" class:staged={s.staging.has('i2sBlock')} title={s.staging.has('i2sBlock') ? `device: ${inputConfig!.i2sEnabled ? 'ON' : 'OFF'}` : undefined}>
              <ToggleSwitch checked={effI2sBlock} ariaLabel={effI2sBlock ? 'Switch I2S input off' : 'Switch I2S input on'} onChange={(v) => Runtime.stageI2sInputEnabled(s, v)} />
            </span>
          {:else}
            <span class="stage-wrap" class:staged={s.staging.has('adatInputEnable')} title={s.staging.has('adatInputEnable') ? `device: ${inputConfig!.adatInputEnabled ? 'ON' : 'OFF'}` : undefined}>
              <ToggleSwitch checked={effAdatEnabled} ariaLabel={effAdatEnabled ? 'Switch ADAT input off' : 'Switch ADAT input on'} onChange={(v) => Runtime.stageAdatInputEnabled(s, v)} />
            </span>
          {/if}
        {/snippet}

        {#snippet simpleRow(src: Domain.AudioInputSource, block: Block, hasRadio: boolean)}
          <div class="lrow" class:hot={src === liveSource}>
            <span class="c1">{#if hasRadio}{@render radio(src, -1, '')}{/if}</span>
            {#if hasRadio}
              <button type="button" class="name" tabindex="-1" onclick={() => onRadio(src, -1)}>{sourceTitle(src)}</button>
            {:else}
              <span class="name">{sourceTitle(src)}</span>
            {/if}
            <span></span><span></span>
            <span class="pins">{@render pinsCell(block)}</span>
          </div>
        {/snippet}

        {@render simpleRow(Domain.AudioInputSource.Usb, 'usb', true)}

        <div class="lrow" class:hot={blockLive === 'spdif'}>
          <span class="c1"></span>
          {#if multiSpdif}
            <span class="name">S/PDIF</span>
          {:else}
            <button type="button" class="name" tabindex="-1" onclick={() => onRadio(Domain.AudioInputSource.Spdif, -1)}>{sourceTitle(Domain.AudioInputSource.Spdif)}</button>
          {/if}
          <span class="c3">
            {#each Array.from({ length: spdifRadios }, (_, k) => k) as k (k)}
              {@render radio(SPDIF_SOURCES[k], multiSpdif ? k : -1, multiSpdif ? String(k + 1) : '')}
            {/each}
            {#if multiSpdif}
              <span class="step">
                {#if effSpdifCount > 1 && !highestHeld}
                  <button type="button" class="chip icon" title={`Remove S/PDIF input ${effSpdifCount}`} aria-label={`Remove S/PDIF input ${effSpdifCount}`} onclick={() => Runtime.stageSpdifInputCount(s, effSpdifCount - 1)}>−</button>
                {/if}
              </span>
              <span class="step">
                {#if effSpdifCount < spdifInputCount}
                  <button type="button" class="chip icon" title={`Add S/PDIF input ${effSpdifCount + 1}`} aria-label={`Add S/PDIF input ${effSpdifCount + 1}`} onclick={() => Runtime.stageSpdifInputCount(s, effSpdifCount + 1)}>+</button>
                {/if}
              </span>
            {/if}
          </span>
          <span></span>
          <span class="pins">{@render pinsCell('spdif')}</span>
        </div>

        {@render simpleRow(Domain.AudioInputSource.I2s, 'i2s', true)}
        {#if features.adatInput}
          {@render simpleRow(Domain.AudioInputSource.Adat, 'adat', effAdatPin !== 0 || liveSource === Domain.AudioInputSource.Adat)}
        {/if}
      </div>
    </div>

    {#if source === Domain.AudioInputSource.Usb}
      {#if showUsbDetected}
        <div class="cfgkvgrid">
          <KV label="DETECTED" value={usbDetected} tone={s.telemetry.activeInputChannels == null ? 'off' : undefined} />
        </div>
      {/if}
      <p class="hint idle">USB input needs no configuration — channel count follows the host.</p>
    {/if}

    {#if isSpdif}
      <div class="subhdr">{subTitle('S/PDIF RX', source)}</div>
      <div class="spdif-grid">
        {#each Array.from({ length: spdifRows }, (_, i) => i) as i (i)}
          <span class="spdif-title">{spdifTitle(i)}</span>
          <span class="stage-wrap" class:staged={s.staging.has(spdifPinKey(i))} title={s.staging.has(spdifPinKey(i)) ? `device: GP${devSpdifPin(i)}` : undefined}>
            <PinPicker
              value={effSpdifPin(i)}
              cells={spdifPinCells(i)}
              placeholder={i === 0 ? undefined : 'UNSET'}
              ariaLabel={`${spdifTitle(i)} RX GPIO pin`}
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
          <KV label="SAMPLE RATE" value={formatRateKHz(spdifStatus.sampleRate)} />
          <KV label="LOCK COUNT"  value={String(spdifStatus.lockCount)} />
          <KV label="LOSS COUNT"  value={String(spdifStatus.lossCount)} tone={spdifStatus.lossCount > 0 ? undefined : 'off'} />
          <KV label="PARITY ERR"  value={String(spdifStatus.parityErrors)} tone={spdifStatus.parityErrors > 0 ? undefined : 'off'} />
          <KV label="FIFO FILL"   value={`${spdifStatus.fifoFillPct}%`} />
        </div>
      {:else}
        <p class="hint idle">Waiting for S/PDIF status…</p>
      {/if}
    {/if}

    {#if isI2s}
      <div class="subhdr">{subTitle('I2S INPUT', source)}</div>
      <div class="cfgkvgrid">
        {#if showSlaveRate}
          <KV
            label="RATE"
            value={slaveRateLocked ? formatRateKHz(slaveStatus?.detectedRateHz ?? 0) : '—'}
            tone={slaveRateLocked ? 'ok' : 'off'}
            title="Slave clock mode: rate follows the external I2S master"
          />
          <p class="hint">auto-detected — external master sets the rate</p>
        {:else}
          <KV label="RATE" value={formatRateKHz(effRate)} />
          <div class="src-btns">
            {#each Domain.I2S_INPUT_RATES_HZ as hz (hz)}
              <button
                class="chip"
                class:on={effRate === hz}
                class:staged={s.staging.has('inputRate') && effRate === hz}
                onclick={() => Runtime.stageInputRate(s, hz)}
                disabled={effRate === hz}
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
                onclick={() => Runtime.stageI2sInputChannels(s, n)}
                disabled={i2sChannels === n}
              >{n}</button>
            {/each}
          </div>
        {/if}
      </div>
      {#each Array.from({ length: i2sActivePairs }, (_, p) => p) as pair (pair)}
        <div class="subhdr">I2S RX PIN{i2sActivePairs > 1 ? ` · PAIR ${pair + 1}` : ''}</div>
        <div class="pinrow">
          <span class="stage-wrap" class:staged={s.staging.has(`i2sRxPin:${pair}`)} title={s.staging.has(`i2sRxPin:${pair}`) ? `device: GP${inputConfig.i2sRxPins[pair] ?? 0}` : undefined}>
            <PinPicker
              value={effI2sRxPin(pair)}
              cells={Domain.pickerCells(snap.platform.type, overlaySnap, ctrlPins, effI2sRxPin(pair))}
              ariaLabel={`I2S RX data pin, stereo pair ${pair + 1}`}
              onChange={(p) => Runtime.stageI2sRxPin(s, pair, p)}
            />
          </span>
        </div>
      {/each}
    {/if}

    {#if source === Domain.AudioInputSource.Adat && features.adatInput}
      <div class="subhdr">{subTitle('ADAT INPUT', source)}</div>
      <div class="cfgkvgrid">
        {#if adatClockMode === 1}
          <KV
            label="RATE"
            value={adatStatus?.state === Domain.AdatInputLockState.Locked ? formatRateKHz(adatStatus.detectedRateHz) : '—'}
            tone={adatStatus?.state === Domain.AdatInputLockState.Locked ? 'ok' : 'off'}
            title="Slave clock mode: rate follows the external ADAT master"
          />
          <p class="hint">auto-detected — external master sets the rate</p>
        {:else}
          <KV label="RATE" value={formatRateKHz(effRate)} />
          <div class="src-btns">
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
          </div>
          {#if adatStatus?.rateOk === false}
            <p class="hint warn">PARKED — device rate above 48 kHz</p>
          {/if}
        {/if}
      </div>
    {/if}
  {/if}
</Panel>

<style>
  .cfgkvgrid { padding: 10px 14px 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: center; }
  .src-btns { display: flex; flex-wrap: wrap; gap: 4px; }
  .src-btns button { white-space: nowrap; }
  .pinrow { padding: 6px 14px 6px; }
  .idle { padding: 10px 14px; }
  .hint.warn { color: var(--warn); }
  .list { display: flex; flex-direction: column; min-width: 300px; }
  .lhdr, .lrow { display: grid; align-items: center; column-gap: 8px; padding: 0 14px; white-space: nowrap; }
  .lhdr { height: 16px; grid-template-columns: 1fr auto; }
  .lhdr .microlbl { color: var(--text-faint); }
  .lrow { height: 26px; grid-template-columns: auto 64px auto 1fr auto; border-top: 1px solid var(--wash); }
  .lrow.hot { background: var(--wash); }
  .c1 { display: inline-flex; width: 16px; }
  .c3 { display: inline-flex; align-items: center; gap: 4px; }
  .name { font-family: var(--font-sans); font-size: var(--fs-m); color: var(--text-dim); background: none; border: none; padding: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; }
  button.name { cursor: pointer; }
  .lrow.hot .name { color: var(--text); }
  .pins { min-width: 56px; display: inline-flex; justify-content: flex-end; align-items: center; }
  .tag { font-family: var(--font-mono); font-size: var(--fs-s); text-transform: uppercase; }
  .tag.ok { color: var(--ok); }
  .tag.warn { color: var(--warn); }
  .tag.faint { color: var(--text-faint); }
  .step { display: inline-flex; width: 20px; justify-content: center; }
  .radio { width: 16px; height: 16px; box-sizing: border-box; padding: 0; border-radius: 50%; border: 1px solid var(--border-hi); background: none; color: var(--text-dim); font-family: var(--font-mono); font-size: var(--fs-s); line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .radio:hover { border-color: var(--text-dim); }
  .radio.live { background: var(--accent); border-color: var(--accent); color: var(--bg); }
  .radio.leaving { border-color: var(--accent); color: var(--accent); }
  .radio.target { background: color-mix(in oklab, var(--accent) var(--tint-strong), transparent); border-color: var(--accent); color: var(--text); }
  .radio.removed { border-style: dashed; border-color: var(--border); color: var(--text-faint); }
  /* An unnumbered radio shows a dot while it is the source. */
  .radio.dot::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0; }
  .radio.live.dot::before, .radio.target.dot::before, .radio.leaving.dot::before { opacity: 1; }
  /* S/PDIF inputs: one row per input -- title | pin -- spread across the
     panel width (title at left, pin at the right edge). */
  .spdif-grid { padding: 8px 14px 4px; display: grid; grid-template-columns: auto auto; justify-content: space-between; row-gap: 12px; column-gap: 12px; align-items: center; }
  .spdif-title { font-family: var(--font-sans); font-size: var(--fs-m); font-weight: 600; color: var(--text-dim); white-space: nowrap; }
</style>

<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import { formatI2cAddr, parseI2cAddr } from '@/components/chrome/format';
  import PinPicker from '@/components/chrome/PinPicker.svelte';
  import * as Staged from '@/runtime/stagedActions';
  import * as Domain from '@/domain';
  import { pinConfigResultFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current ? s.staging.overlaySnapshot(s.mirror.current) : null);
  const uart = $derived(Staged.stagedUart(s));
  const i2c = $derived(Staged.stagedI2c(s));
  const status = $derived(s.ctrlIfaces.status);

  const csPins = $derived(Domain.liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status));
  const displayInstance = $derived(Domain.csDisplayI2cInstance(csPins));

  function uartTxReason(pin: number): string {
    return pin % 4 !== 0 ? 'UART TX must be GP0/4/8…' : `needs GP${pin + 1} free`;
  }
  function i2cSdaReason(pin: number): string {
    if (pin % 2 !== 0) return 'SDA must be even';
    if (Domain.i2cInstance(pin) === displayInstance) return 'That I2C bus is used by the display';
    return `needs GP${pin + 1} free`;
  }

  const uartTxCells = $derived(
    snap ? Domain.pickerCellsFrom(snap.platform.type, snap, { i2c, cs: csPins }, Domain.validUartTxPins(snap.platform.type, snap, { i2c, cs: csPins }), uart?.txPin, uartTxReason) : [],
  );
  const i2cSdaCells = $derived(
    snap ? Domain.pickerCellsFrom(snap.platform.type, snap, { uart, cs: csPins }, Domain.validI2cSdaPins(snap.platform.type, snap, { uart, cs: csPins }, displayInstance), i2c?.sdaPin, i2cSdaReason) : [],
  );

  function lastStatusMessage(byte: number | undefined): string | null {
    if (byte == null) return null;
    const r = pinConfigResultFromByte(byte);
    return r.ok ? null : r.message;
  }
  const uartStatusMsg = $derived(lastStatusMessage(status?.uartLastStatus));
  const i2cStatusMsg = $derived(lastStatusMessage(status?.i2cLastStatus));
  const liveUart = $derived(s.ctrlIfaces.uart);
  const liveI2c = $derived(s.ctrlIfaces.i2c);
  const uartDown = $derived(liveUart?.enabled === true && status != null && !status.uartLive);
  const i2cDown = $derived(liveI2c?.enabled === true && status != null && !status.i2cLive);

  let addrText = $state<string | null>(null);
  const addrInvalid = $derived(addrText !== null && parseI2cAddr(addrText) === null);
  function onAddressInput(e: Event) {
    addrText = (e.target as HTMLInputElement).value;
    const parsed = parseI2cAddr(addrText);
    if (parsed === null) return;
    addrText = null;
    Staged.stageI2c(s, 'address', parsed);
  }

</script>

<Panel title="CONTROL INTERFACES">
  {#if uart}
    <div class="subhdr">
      <span class="lhs">
        UART
        <span class="stage-wrap" class:staged={s.staging.has('uart:enabled')}><ToggleSwitch
          checked={uart.enabled}
          ariaLabel={uart.enabled ? 'Disable UART control interface' : 'Enable UART control interface'}
          onChange={(v) => Staged.stageUartEnabled(s, v)}
        /></span>
      </span>
      <span class="status" class:live={liveUart?.enabled && status?.uartLive} class:down={liveUart?.enabled && !status?.uartLive}>
        {liveUart?.enabled ? (status?.uartLive ? 'LIVE' : 'DOWN') : 'DISABLED'}
      </span>
    </div>
    <div class="rows">
      <span class="pair">
        <span class="microlbl">TX</span>
        <span class="stage-wrap" class:staged={s.staging.has('uart:txPin')}><PinPicker
          value={uart.txPin}
          cells={uartTxCells}
          ariaLabel="UART TX pin"
          disabled={!uart.enabled}
          onChange={(p) => Staged.stageUart(s, 'txPin', p)}
        /></span>
      </span>
      <span class="pair">
        <span class="microlbl">RX</span>
        <span class="pinval" title="follows TX">GP{uart.rxPin}</span>
      </span>
      <span class="pair">
        <span class="microlbl">BAUD</span>
        <span class="stage-wrap" class:staged={s.staging.has('uart:baud')}><select
          class="sel"
          value={String(uart.baud)}
          aria-label="UART baud rate"
          disabled={!uart.enabled}
          onchange={(e) => Staged.stageUart(s, 'baud', Number((e.currentTarget as HTMLSelectElement).value))}
        >
          {#each Domain.UART_COMMON_BAUDS as baud (baud)}
            <option value={String(baud)}>{baud}</option>
          {/each}
        </select></span>
      </span>
      <span class="pair">
        <span class="microlbl">NOTIFY</span>
        <span class="stage-wrap" class:staged={s.staging.has('uart:notifyEnabled')}><ToggleSwitch
          ariaLabel="Push async notifications over UART"
          checked={uart.notifyEnabled}
          disabled={!uart.enabled}
          onChange={(v) => Staged.stageUart(s, 'notifyEnabled', v)}
        /></span>
      </span>
      {#if uartDown || uartStatusMsg}
        <div class="hint err">{uartStatusMsg ?? 'configured but not live (pin collision at boot?)'}</div>
      {/if}
    </div>
  {/if}

  {#if i2c}
    <div class="subhdr">
      <span class="lhs">
        I2C
        <span class="stage-wrap" class:staged={s.staging.has('i2c:enabled')}><ToggleSwitch
          checked={i2c.enabled}
          ariaLabel={i2c.enabled ? 'Disable I2C control interface' : 'Enable I2C control interface'}
          onChange={(v) => Staged.stageI2cEnabled(s, v)}
        /></span>
      </span>
      <span class="status" class:live={liveI2c?.enabled && status?.i2cLive} class:down={liveI2c?.enabled && !status?.i2cLive}>
        {liveI2c?.enabled ? (status?.i2cLive ? 'LIVE' : 'DOWN') : 'DISABLED'}
      </span>
    </div>
    <div class="rows">
      <span class="pair">
        <span class="microlbl">SDA</span>
        <span class="stage-wrap" class:staged={s.staging.has('i2c:sdaPin')}><PinPicker
          value={i2c.sdaPin}
          cells={i2cSdaCells}
          ariaLabel="I2C SDA pin"
          disabled={!i2c.enabled}
          onChange={(p) => Staged.stageI2c(s, 'sdaPin', p)}
        /></span>
      </span>
      <span class="pair">
        <span class="microlbl">SCL</span>
        <span class="pinval" title="follows SDA">GP{i2c.sclPin}</span>
      </span>
      <span class="pair">
        <span class="microlbl">ADDR</span>
        <span class="stage-wrap" class:staged={s.staging.has('i2c:address')}><input
          class="numfield"
          type="text"
          value={addrText ?? formatI2cAddr(i2c.address)}
          onchange={onAddressInput}
          disabled={!i2c.enabled}
          aria-label="I2C target address (hex)"
        /></span>
      </span>
      {#if addrInvalid}
        <div class="hint err">Address must be {formatI2cAddr(Domain.I2C_ADDRESS_MIN)}–{formatI2cAddr(Domain.I2C_ADDRESS_MAX)}</div>
      {/if}
      {#if i2cDown || i2cStatusMsg}
        <div class="hint err">{i2cStatusMsg ?? 'configured but not live (pin collision at boot?)'}</div>
      {/if}
    </div>
  {/if}

  {#if !uart && !i2c}
    {#if s.ctrlIfaces.lastFetchError}
      <div class="hint err pad">{s.ctrlIfaces.lastFetchError}</div>
    {:else}
      <div class="hint pad">Reading control interfaces…</div>
    {/if}
  {/if}
</Panel>

<style>
  .subhdr {
    padding: 10px 14px 4px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  /* The global .subhdr (controls.css) adds a border-top + margin-top section
     separator; drop both on the first subheader so it sits flush under the
     panel header. */
  .subhdr:first-of-type { margin-top: 0; border-top: none; }
  .lhs { display: flex; align-items: center; gap: 8px; }
  .status {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
  }
  .status.live { color: var(--ok); }
  .status.down { color: var(--warn); }
  .rows {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 4px 14px 10px;
  }
  .numfield {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    width: 60px;
  }
  .pair { display: inline-flex; align-items: center; gap: 6px; }
  .pinval {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
  }
  .hint.err { flex-basis: 100%; }
  .pad { padding: 10px 14px; }
</style>

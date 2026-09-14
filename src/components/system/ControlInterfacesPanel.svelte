<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinPicker from './PinPicker.svelte';
  import { setUartControlConfig, setI2cControlConfig } from '@/runtime';
  import {
    validUartTxPins, validI2cSdaPins, csDisplayI2cInstance, i2cInstance, pickerCellsFrom, liveCsPinConfigs,
    UART_COMMON_BAUDS, I2C_ADDRESS_MIN, I2C_ADDRESS_MAX,
    type UartControlConfig, type I2cControlConfig,
  } from '@/domain';
  import { pinConfigResultFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const uart = $derived(s.ctrlIfaces.uart);
  const i2c = $derived(s.ctrlIfaces.i2c);
  const status = $derived(s.ctrlIfaces.status);

  const csPins = $derived(liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status));
  const displayInstance = $derived(csDisplayI2cInstance(csPins));

  function uartTxReason(pin: number): string {
    return pin % 4 !== 0 ? 'UART TX must be GP0/4/8…' : `needs GP${pin + 1} free`;
  }
  function i2cSdaReason(pin: number): string {
    if (pin % 2 !== 0) return 'SDA must be even';
    if (i2cInstance(pin) === displayInstance) return 'That I2C bus is used by the display';
    return `needs GP${pin + 1} free`;
  }

  const uartTxCells = $derived(
    snap ? pickerCellsFrom(snap.platform.type, snap, { i2c, cs: csPins }, validUartTxPins(snap.platform.type, snap, { i2c, cs: csPins }), uart?.txPin, uartTxReason) : [],
  );
  const i2cSdaCells = $derived(
    snap ? pickerCellsFrom(snap.platform.type, snap, { uart, cs: csPins }, validI2cSdaPins(snap.platform.type, snap, { uart, cs: csPins }, displayInstance), i2c?.sdaPin, i2cSdaReason) : [],
  );

  function lastStatusMessage(byte: number | undefined): string | null {
    if (byte == null) return null;
    const r = pinConfigResultFromByte(byte);
    return r.ok ? null : r.message;
  }
  const uartStatusMsg = $derived(lastStatusMessage(status?.uartLastStatus));
  const i2cStatusMsg = $derived(lastStatusMessage(status?.i2cLastStatus));
  const uartDown = $derived(uart?.enabled === true && status != null && !status.uartLive);
  const i2cDown = $derived(i2c?.enabled === true && status != null && !status.i2cLive);

  function patchUart(p: Partial<UartControlConfig>) {
    if (!uart) return;
    setUartControlConfig(s, { ...uart, ...p });
  }

  function patchI2c(p: Partial<I2cControlConfig>) {
    if (!i2c) return;
    setI2cControlConfig(s, { ...i2c, ...p });
  }

  function onToggleUartEnabled() {
    if (!uart || !snap) return;
    if (uart.enabled) { patchUart({ enabled: false }); return; }
    const candidates = validUartTxPins(snap.platform.type, snap, { i2c });
    const txPin = candidates.includes(uart.txPin) ? uart.txPin : (candidates[0] ?? uart.txPin);
    patchUart({ enabled: true, txPin, rxPin: txPin + 1 });
  }

  function onToggleI2cEnabled() {
    if (!i2c || !snap) return;
    if (i2c.enabled) { patchI2c({ enabled: false }); return; }
    const candidates = validI2cSdaPins(snap.platform.type, snap, { uart, cs: csPins }, displayInstance);
    const sdaPin = candidates.includes(i2c.sdaPin) ? i2c.sdaPin : (candidates[0] ?? i2c.sdaPin);
    patchI2c({ enabled: true, sdaPin, sclPin: sdaPin + 1 });
  }

  function onUartTxPin(pin: number) {
    patchUart({ txPin: pin, rxPin: pin + 1 });
  }

  function onI2cSdaPin(pin: number) {
    patchI2c({ sdaPin: pin, sclPin: pin + 1 });
  }

  function onAddressInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value.trim();
    const parsed = parseInt(raw, 16);
    if (Number.isNaN(parsed) || parsed < I2C_ADDRESS_MIN || parsed > I2C_ADDRESS_MAX) return;
    patchI2c({ address: parsed });
  }

  function fmtAddress(addr: number): string {
    return `0x${addr.toString(16).padStart(2, '0').toUpperCase()}`;
  }
</script>

<Panel code="CT.01" title="CONTROL INTERFACES">
  {#if uart}
    <div class="subhdr">
      <span class="lhs">
        UART
        <ToggleSwitch
          size="sm"
          checked={uart.enabled}
          ariaLabel={uart.enabled ? 'Disable UART control interface' : 'Enable UART control interface'}
          onChange={onToggleUartEnabled}
        />
      </span>
      <span class="status" class:live={uart.enabled && status?.uartLive} class:down={uart.enabled && !status?.uartLive}>
        {uart.enabled ? (status?.uartLive ? 'LIVE' : 'DOWN') : 'DISABLED'}
      </span>
    </div>
    <div class="rows" class:dimmed={!uart.enabled}>
      <span class="pair">
        <span class="microlbl">TX</span>
        <PinPicker
          value={uart.txPin}
          cells={uartTxCells}
          ariaLabel="UART TX pin"
          disabled={!uart.enabled}
          onChange={onUartTxPin}
        />
      </span>
      <span class="pair">
        <span class="microlbl">RX</span>
        <span class="pinval" title="follows TX">GP{uart.rxPin}</span>
      </span>
      <span class="pair">
        <span class="microlbl">BAUD</span>
        <select
          class="sel"
          value={String(uart.baud)}
          aria-label="UART baud rate"
          disabled={!uart.enabled}
          onchange={(e) => patchUart({ baud: Number((e.currentTarget as HTMLSelectElement).value) })}
        >
          {#each UART_COMMON_BAUDS as baud (baud)}
            <option value={String(baud)}>{baud}</option>
          {/each}
        </select>
      </span>
      <span class="pair">
        <span class="microlbl">NOTIFY</span>
        <ToggleSwitch
          size="sm"
          ariaLabel="Push async notifications over UART"
          checked={uart.notifyEnabled}
          disabled={!uart.enabled}
          onChange={(v) => patchUart({ notifyEnabled: v })}
        />
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
        <ToggleSwitch
          size="sm"
          checked={i2c.enabled}
          ariaLabel={i2c.enabled ? 'Disable I2C control interface' : 'Enable I2C control interface'}
          onChange={onToggleI2cEnabled}
        />
      </span>
      <span class="status" class:live={i2c.enabled && status?.i2cLive} class:down={i2c.enabled && !status?.i2cLive}>
        {i2c.enabled ? (status?.i2cLive ? 'LIVE' : 'DOWN') : 'DISABLED'}
      </span>
    </div>
    <div class="rows" class:dimmed={!i2c.enabled}>
      <span class="pair">
        <span class="microlbl">SDA</span>
        <PinPicker
          value={i2c.sdaPin}
          cells={i2cSdaCells}
          ariaLabel="I2C SDA pin"
          disabled={!i2c.enabled}
          onChange={onI2cSdaPin}
        />
      </span>
      <span class="pair">
        <span class="microlbl">SCL</span>
        <span class="pinval" title="follows SDA">GP{i2c.sclPin}</span>
      </span>
      <span class="pair">
        <span class="microlbl">ADDR</span>
        <input
          class="numfield"
          type="text"
          value={fmtAddress(i2c.address)}
          onchange={onAddressInput}
          disabled={!i2c.enabled}
          aria-label="I2C target address (hex)"
        />
      </span>
      {#if i2cDown || i2cStatusMsg}
        <div class="hint err">{i2cStatusMsg ?? 'configured but not live (pin collision at boot?)'}</div>
      {/if}
    </div>
  {/if}
</Panel>

<style>
  .subhdr {
    padding: 10px 14px 4px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--text-faint);
    text-transform: uppercase;
  }
  /* The global .subhdr (controls.css) adds a border-top + margin-top section
     separator; drop both on the first subheader so it sits right under the
     panel header, matching other System panels' first-row rhythm. */
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
  .sel {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .sel:disabled { opacity: var(--dim-disabled); cursor: default; }
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
  .hint.err { color: var(--err); flex-basis: 100%; }
</style>

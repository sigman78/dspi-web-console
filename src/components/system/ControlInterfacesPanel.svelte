<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import PinSelect from './PinSelect.svelte';
  import { connection } from '@/state';
  import { setUartControlConfig, setI2cControlConfig } from '@/runtime';
  import {
    validUartTxPins, validI2cSdaPins,
    UART_COMMON_BAUDS, I2C_ADDRESS_MIN, I2C_ADDRESS_MAX,
    type UartControlConfig, type I2cControlConfig,
  } from '@/domain';
  import { pinConfigResultFromByte } from '@/protocol';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const snap = $derived(s.mirror.current);
  const uart = $derived(s.ctrlIfaces.uart);
  const i2c = $derived(s.ctrlIfaces.i2c);
  const status = $derived(s.ctrlIfaces.status);

  const uartTxCandidates = $derived(
    snap ? validUartTxPins(snap.platform.type, snap, { i2c }).map((pin) => ({ pin, usedBy: null })) : [],
  );
  const i2cSdaCandidates = $derived(
    snap ? validI2cSdaPins(snap.platform.type, snap, { uart }).map((pin) => ({ pin, usedBy: null })) : [],
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
    const candidates = validI2cSdaPins(snap.platform.type, snap, { uart });
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

<Panel code="SY.13" title="CONTROL INTERFACES">
  {#if uart}
    <div class="subhdr">
      UART
      <ToggleSwitch
        size="sm"
        checked={uart.enabled}
        disabled={!connected}
        ariaLabel={uart.enabled ? 'Disable UART control interface' : 'Enable UART control interface'}
        onChange={onToggleUartEnabled}
      />
    </div>
    <div class="rows" class:dimmed={!uart.enabled}>
      <div class="row">
        <span class="microlbl">TX PIN</span>
        <PinSelect
          value={uart.txPin}
          candidates={uartTxCandidates}
          ariaLabel="UART TX pin"
          disabled={!connected || !uart.enabled}
          onChange={onUartTxPin}
        />
        <span class="microlbl">RX PIN</span>
        <PinSelect
          value={uart.rxPin}
          candidates={[{ pin: uart.rxPin, usedBy: null }]}
          ariaLabel="UART RX pin (follows TX)"
          disabled
          onChange={() => {}}
        />
      </div>

      <div class="row">
        <span class="microlbl">BAUD</span>
        <select
          class="sel"
          value={String(uart.baud)}
          aria-label="UART baud rate"
          disabled={!connected || !uart.enabled}
          onchange={(e) => patchUart({ baud: Number((e.currentTarget as HTMLSelectElement).value) })}
        >
          {#each UART_COMMON_BAUDS as baud (baud)}
            <option value={String(baud)}>{baud}</option>
          {/each}
        </select>
        <span class="microlbl">NOTIFY</span>
        <ToggleSwitch
          size="sm"
          ariaLabel="Push async notifications over UART"
          checked={uart.notifyEnabled}
          disabled={!connected || !uart.enabled}
          onChange={(v) => patchUart({ notifyEnabled: v })}
        />
      </div>

      <KV label="STATUS" value={uart.enabled ? (status?.uartLive ? 'LIVE' : 'DOWN') : 'DISABLED'}
        tone={uart.enabled ? (status?.uartLive ? 'ok' : undefined) : 'off'} />
      {#if uartDown || uartStatusMsg}
        <div class="hint err">{uartStatusMsg ?? 'configured but not live (pin collision at boot?)'}</div>
      {/if}
    </div>
  {/if}

  {#if i2c}
    <div class="subhdr">
      I2C
      <ToggleSwitch
        size="sm"
        checked={i2c.enabled}
        disabled={!connected}
        ariaLabel={i2c.enabled ? 'Disable I2C control interface' : 'Enable I2C control interface'}
        onChange={onToggleI2cEnabled}
      />
    </div>
    <div class="rows" class:dimmed={!i2c.enabled}>
      <div class="row">
        <span class="microlbl">SDA PIN</span>
        <PinSelect
          value={i2c.sdaPin}
          candidates={i2cSdaCandidates}
          ariaLabel="I2C SDA pin"
          disabled={!connected || !i2c.enabled}
          onChange={onI2cSdaPin}
        />
        <span class="microlbl">SCL PIN</span>
        <PinSelect
          value={i2c.sclPin}
          candidates={[{ pin: i2c.sclPin, usedBy: null }]}
          ariaLabel="I2C SCL pin (follows SDA)"
          disabled
          onChange={() => {}}
        />
      </div>

      <div class="row">
        <span class="microlbl">ADDRESS</span>
        <input
          class="numfield"
          type="text"
          value={fmtAddress(i2c.address)}
          onchange={onAddressInput}
          disabled={!connected || !i2c.enabled}
          aria-label="I2C target address (hex)"
        />
      </div>

      <KV label="STATUS" value={i2c.enabled ? (status?.i2cLive ? 'LIVE' : 'DOWN') : 'DISABLED'}
        tone={i2c.enabled ? (status?.i2cLive ? 'ok' : undefined) : 'off'} />
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
  .rows {
    padding: 4px 14px 12px;
    display: grid;
    grid-template-columns: max-content max-content max-content max-content;
    gap: 8px 10px;
    align-items: center;
    justify-content: space-between;
  }
  .row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center; }
  .rows > .hint, .rows > :global(.kv) { grid-column: 1 / -1; }
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
    width: 70px;
  }
  .hint.err { color: var(--err); }
</style>

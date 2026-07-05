// External control interfaces (fw 1.1.5, wire V16+): a UART control transport
// and an I2C target, configured over five vendor commands (0xF5-0xF9). Mirrors
// the firmware's own pin/parity/instance rules client-side; last_status stays
// the backstop for conflicts the host can't see (live control-surface bindings).

export interface UartControlConfig {
  enabled: boolean;
  txPin: number;
  rxPin: number;
  notifyEnabled: boolean;
  baud: number;
}

export interface I2cControlConfig {
  enabled: boolean;
  sdaPin: number;
  sclPin: number;
  address: number;
}

// last_status carries a PinConfigResult-shaped byte (protocol/results.ts);
// kept as a raw number here so domain stays independent of the protocol layer.
export interface ControlIfaceStatus {
  uartLastStatus: number;
  uartLive: boolean;
  i2cLastStatus: number;
  i2cLive: boolean;
  protoVersion: number;
}

export const UART_BAUD_MIN = 9600;
export const UART_BAUD_MAX = 1_000_000;

// Common rates for the UI's baud picker; 115200 is the firmware default.
export const UART_COMMON_BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600] as const;

export const I2C_ADDRESS_MIN = 0x08;
export const I2C_ADDRESS_MAX = 0x77;

export const DEFAULT_UART_CONTROL_CONFIG: UartControlConfig = {
  enabled: false, txPin: 16, rxPin: 17, notifyEnabled: false, baud: 115200,
};

export const DEFAULT_I2C_CONTROL_CONFIG: I2cControlConfig = {
  enabled: false, sdaPin: 18, sclPin: 19, address: 0x42,
};

// RP2040/RP2350 GPIO mux (vendor_commands.c): which UART/I2C hardware
// instance a pin belongs to.
export function uartInstance(pin: number): number {
  return ((pin >> 3) & 1) ^ ((pin >> 2) & 1);
}

export function i2cInstance(pin: number): number {
  return (pin >> 1) & 1;
}

export function isValidUartPinPair(txPin: number, rxPin: number): boolean {
  return txPin % 4 === 0 && rxPin % 4 === 1 && uartInstance(txPin) === uartInstance(rxPin);
}

export function isValidI2cPinPair(sdaPin: number, sclPin: number): boolean {
  return sdaPin % 2 === 0 && sclPin % 2 === 1 && i2cInstance(sdaPin) === i2cInstance(sclPin);
}

export function isValidUartBaud(baud: number): boolean {
  return Number.isInteger(baud) && baud >= UART_BAUD_MIN && baud <= UART_BAUD_MAX;
}

export function isValidI2cAddress(addr: number): boolean {
  return Number.isInteger(addr) && addr >= I2C_ADDRESS_MIN && addr <= I2C_ADDRESS_MAX;
}

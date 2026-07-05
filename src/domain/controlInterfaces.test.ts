import { describe, it, expect } from 'vitest';
import {
  uartInstance, i2cInstance, isValidUartPinPair, isValidI2cPinPair,
  isValidUartBaud, isValidI2cAddress,
  DEFAULT_UART_CONTROL_CONFIG, DEFAULT_I2C_CONTROL_CONFIG,
} from './controlInterfaces';

describe('uartInstance', () => {
  it('groups the documented TX pins onto UART0 / UART1', () => {
    for (const pin of [0, 12, 16, 28]) expect(uartInstance(pin)).toBe(0);
    for (const pin of [4, 8, 20, 24]) expect(uartInstance(pin)).toBe(1);
  });
});

describe('i2cInstance', () => {
  it('splits even/odd pin pairs by hardware instance', () => {
    expect(i2cInstance(18)).toBe(i2cInstance(19));
    expect(i2cInstance(0)).not.toBe(i2cInstance(2));
  });
});

describe('isValidUartPinPair', () => {
  it('accepts the documented TX/RX pattern on the same instance', () => {
    expect(isValidUartPinPair(16, 17)).toBe(true);
    expect(isValidUartPinPair(0, 1)).toBe(true);
  });

  it('rejects a parity mismatch or a cross-instance pair', () => {
    expect(isValidUartPinPair(17, 18)).toBe(false);   // TX must be %4==0
    expect(isValidUartPinPair(16, 21)).toBe(false);   // RX on a different UART instance
  });
});

describe('isValidI2cPinPair', () => {
  it('accepts an even/odd pair on the same instance', () => {
    expect(isValidI2cPinPair(18, 19)).toBe(true);
  });

  it('rejects a parity mismatch or a cross-instance pair', () => {
    expect(isValidI2cPinPair(19, 18)).toBe(false);
    expect(isValidI2cPinPair(18, 17)).toBe(false);   // both parity-valid, different I2C instance
  });
});

describe('bounds', () => {
  it('accepts the firmware baud/address range and rejects outside it', () => {
    expect(isValidUartBaud(9600)).toBe(true);
    expect(isValidUartBaud(1_000_000)).toBe(true);
    expect(isValidUartBaud(9599)).toBe(false);
    expect(isValidUartBaud(1_000_001)).toBe(false);

    expect(isValidI2cAddress(0x08)).toBe(true);
    expect(isValidI2cAddress(0x77)).toBe(true);
    expect(isValidI2cAddress(0x07)).toBe(false);
    expect(isValidI2cAddress(0x78)).toBe(false);
  });
});

describe('defaults', () => {
  it('ship disabled with a self-consistent pin pair', () => {
    expect(DEFAULT_UART_CONTROL_CONFIG.enabled).toBe(false);
    expect(isValidUartPinPair(DEFAULT_UART_CONTROL_CONFIG.txPin, DEFAULT_UART_CONTROL_CONFIG.rxPin)).toBe(true);
    expect(DEFAULT_I2C_CONTROL_CONFIG.enabled).toBe(false);
    expect(isValidI2cPinPair(DEFAULT_I2C_CONTROL_CONFIG.sdaPin, DEFAULT_I2C_CONTROL_CONFIG.sclPin)).toBe(true);
  });
});

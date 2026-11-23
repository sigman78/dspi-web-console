import { describe, it, expect } from 'vitest';
import { sanitizeDeviceName, inputSourceTitle, spdifNumbered, selectableInputSources, DEVICE_NAME_MAX_LEN } from './deviceNames';
import { AudioInputSource } from './deviceSections';

describe('sanitizeDeviceName', () => {
  it('drops non-printable and non-ASCII characters', () => {
    expect(sanitizeDeviceName('Café\t–\u0007 Rack')).toBe('Caf Rack');
  });

  it('caps at the stored length, counting kept characters only', () => {
    const out = sanitizeDeviceName('é'.repeat(10) + 'a'.repeat(50));
    expect(out).toBe('a'.repeat(DEVICE_NAME_MAX_LEN));
  });
});

describe('inputSourceTitle', () => {
  it('prefers the custom name and falls back to the built-in label when it is empty or absent', () => {
    expect(inputSourceTitle(AudioInputSource.Spdif, { [AudioInputSource.Spdif]: 'TV' })).toBe('TV');
    expect(inputSourceTitle(AudioInputSource.Spdif, { [AudioInputSource.Spdif]: '' })).toBe('S/PDIF');
    expect(inputSourceTitle(AudioInputSource.Spdif, undefined, spdifNumbered({ spdifCount: 2 }))).toBe('S/PDIF 1');
    expect(inputSourceTitle(AudioInputSource.Spdif, undefined, spdifNumbered({ spdifCount: 1 }))).toBe('S/PDIF');
    expect(inputSourceTitle(AudioInputSource.I2s, {})).toBe('I2S');
  });
});

describe('selectableInputSources', () => {
  it('lists the extra S/PDIF inputs and ADAT only where the device has them', () => {
    expect(selectableInputSources(1, false)).toEqual([AudioInputSource.Usb, AudioInputSource.Spdif, AudioInputSource.I2s]);
    expect(selectableInputSources(4, true)).toEqual([
      AudioInputSource.Usb, AudioInputSource.Spdif, AudioInputSource.Spdif2, AudioInputSource.Spdif3,
      AudioInputSource.Spdif4, AudioInputSource.I2s, AudioInputSource.Adat,
    ]);
  });
});

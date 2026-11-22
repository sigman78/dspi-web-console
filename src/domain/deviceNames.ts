// Board and input-source names held on the device (REQ_*_INPUT_SOURCE_NAME,
// REQ_*_DEVICE_NAME). Empty means "unnamed": each host supplies its own label.

import { AudioInputSource, type InputConfig } from './deviceSections';

export const DEVICE_NAME_MAX_LEN = 31;

// Names the front panel font can show: printable ASCII only, capped at the
// 31 bytes the device stores.
export function sanitizeDeviceName(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7E) out += ch;
    if (out.length === DEVICE_NAME_MAX_LEN) break;
  }
  return out;
}

// Source IDs the device can select, in picker order.
export function selectableInputSources(spdifInputCount: number, adat: boolean): AudioInputSource[] {
  const out: AudioInputSource[] = [AudioInputSource.Usb, AudioInputSource.Spdif];
  if (spdifInputCount > 1) out.push(AudioInputSource.Spdif2, AudioInputSource.Spdif3, AudioInputSource.Spdif4);
  out.push(AudioInputSource.I2s);
  if (adat) out.push(AudioInputSource.Adat);
  return out;
}

// True once the S/PDIF block holds more than one input; only then is the first
// input numbered ("S/PDIF 1") to tell them apart.
export function spdifNumbered(cfg: Pick<InputConfig, 'spdifCount'> | undefined): boolean {
  return (cfg?.spdifCount ?? 1) > 1;
}

// Built-in label.
export function inputSourceLabel(source: number, spdifNumbered = false): string {
  switch (source) {
    case AudioInputSource.Spdif:  return spdifNumbered ? 'S/PDIF 1' : 'S/PDIF';
    case AudioInputSource.Spdif2: return 'S/PDIF 2';
    case AudioInputSource.Spdif3: return 'S/PDIF 3';
    case AudioInputSource.Spdif4: return 'S/PDIF 4';
    case AudioInputSource.I2s:    return 'I2S';
    case AudioInputSource.Adat:   return 'ADAT';
    case AudioInputSource.Usb:    return 'USB';
    default:                      return `Source ${source}`;
  }
}

// Custom name when set, else the built-in label.
export function inputSourceTitle(
  source: number, names: Readonly<Record<number, string>> | undefined, numberedSpdif = false,
): string {
  return names?.[source] || inputSourceLabel(source, numberedSpdif);
}

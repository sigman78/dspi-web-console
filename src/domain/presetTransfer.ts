// Preset export/import envelope. The blob is the device's own bulk packet, so
// it is only meaningful to a device on the same firmware and wire generation.

const KIND = 'dspi-preset';
const VERSION = 1;

export interface PresetTransferHeader {
  fwVersion: string;
  wire: number;
}

export type PresetTransferParse =
  | { ok: true; name: string; blob: Uint8Array }
  | { ok: false; reason: string };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serializePresetTransfer(p: PresetTransferHeader & { name: string; blob: Uint8Array }): string {
  return JSON.stringify({
    kind: KIND,
    version: VERSION,
    name: p.name,
    fwVersion: p.fwVersion,
    wire: p.wire,
    blob: toBase64(p.blob),
  }, null, 2);
}

export function parsePresetTransfer(text: string, device: PresetTransferHeader): PresetTransferParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Not a preset file (invalid JSON).' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'Not a preset file.' };
  const o = raw as Record<string, unknown>;
  if (o.kind !== KIND) return { ok: false, reason: 'Not a DSPi preset file.' };
  if (o.version !== VERSION) return { ok: false, reason: `Unsupported preset file version ${String(o.version)}.` };
  if (typeof o.blob !== 'string') return { ok: false, reason: 'Preset file has no data.' };
  const blob = fromBase64(o.blob);
  if (blob === null) return { ok: false, reason: 'Preset data is corrupt (bad base64).' };
  if (typeof o.fwVersion !== 'string') return { ok: false, reason: 'Preset file has no firmware tag.' };
  if (o.fwVersion !== device.fwVersion || o.wire !== device.wire) {
    return {
      ok: false,
      reason: `Preset is from firmware ${String(o.fwVersion)} (wire ${String(o.wire)}); this device runs ${device.fwVersion} (wire ${device.wire}).`,
    };
  }
  return { ok: true, name: typeof o.name === 'string' ? o.name : '', blob };
}

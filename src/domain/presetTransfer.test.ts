import { describe, expect, it } from 'vitest';
import { parsePresetTransfer, serializePresetTransfer } from './presetTransfer';

const dev = { fwVersion: '1.1.6', wire: 32 };
const blob = Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) & 0xff);
const good = () => serializePresetTransfer({ name: 'Living room', ...dev, blob });

describe('presetTransfer', () => {
  it('round-trips name and bytes, including large blobs', () => {
    const r = parsePresetTransfer(good(), dev);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.name).toBe('Living room');
      expect(r.blob).toEqual(blob);
    }
  });

  it('refuses a different firmware or wire generation', () => {
    expect(parsePresetTransfer(good(), { ...dev, fwVersion: '1.1.5' }).ok).toBe(false);
    expect(parsePresetTransfer(good(), { ...dev, wire: 16 }).ok).toBe(false);
  });

  it('refuses wrong kind, wrong version, bad JSON and bad base64', () => {
    const base = JSON.parse(good()) as Record<string, unknown>;
    const with_ = (patch: Record<string, unknown>) => JSON.stringify({ ...base, ...patch });
    expect(parsePresetTransfer(with_({ kind: 'other' }), dev).ok).toBe(false);
    expect(parsePresetTransfer(with_({ version: 2 }), dev).ok).toBe(false);
    expect(parsePresetTransfer(with_({ blob: 'not base64!' }), dev).ok).toBe(false);
    expect(parsePresetTransfer(with_({ blob: 'abc' }), dev).ok).toBe(false);
    expect(parsePresetTransfer('{nope', dev).ok).toBe(false);
    const noFw = parsePresetTransfer(with_({ fwVersion: undefined }), dev);
    expect(noFw).toEqual({ ok: false, reason: 'Preset file has no firmware tag.' });
  });
});

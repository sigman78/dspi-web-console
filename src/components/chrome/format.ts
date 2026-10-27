const MINUS = '−';

/** Signed dB with a true minus, an explicit plus, and `−∞` for negative infinity. Values that round to zero carry no sign. */
export function formatSignedDb(db: number, digits = 1): string {
  if (db === -Infinity) return `${MINUS}∞`;
  if (!Number.isFinite(db)) return '—';
  const mag = Math.abs(db).toFixed(digits);
  if (Number(mag) === 0) return mag;
  return `${db < 0 ? MINUS : '+'}${mag}`;
}

/** Master volume readout; the mute sentinel (at/below -127.5 dB) reads as minus infinity. */
export function formatMasterDb(db: number): string {
  return formatSignedDb(db <= -127.5 ? -Infinity : db);
}

/** I²C address as zero-padded hex, e.g. `0x0A`. */
export function formatI2cAddr(addr: number): string {
  return `0x${addr.toString(16).padStart(2, '0').toUpperCase()}`;
}

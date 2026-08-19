// Master volume's firmware range (-128..0 dB, -128 = mute sentinel) is too wide
// for a linear slider: 1 dB steps would need 129 positions, most of them in a
// deep-attenuation tail nobody dials by ear. Instead the slider walks a fixed
// index (0..104) into a piecewise step table -- fine 0.5 dB resolution near the
// 0 dB ceiling where levels actually get set, coarser 5 dB steps in the tail
// that exists mostly to get out of the way. This table mirrors the reference
// desktop console's taper so both UIs land on identical grid values for the
// same slider position.

function buildSteps(): number[] {
  const steps: number[] = [-128];
  for (let db = -125; db <= -65; db += 5) steps.push(db);
  for (let db = -60; db <= -31; db += 1) steps.push(db);
  // Integer loop over half-dB units avoids float accumulation drift.
  for (let half = -60; half <= 0; half++) steps.push(half / 2);
  return steps;
}

export const MASTER_VOLUME_STEPS: readonly number[] = buildSteps();
export const MASTER_VOLUME_MAX_POS = MASTER_VOLUME_STEPS.length - 1;

// Nearest position for an arbitrary float (device/preset values aren't always
// exactly on the grid).
export function masterDbToPos(db: number): number {
  if (db <= -127.5) return 0;
  if (db >= 0) return MASTER_VOLUME_MAX_POS;
  let nearestPos = 0;
  let nearestDiff = Infinity;
  for (let pos = 0; pos < MASTER_VOLUME_STEPS.length; pos++) {
    const diff = Math.abs(MASTER_VOLUME_STEPS[pos] - db);
    if (diff < nearestDiff) {
      nearestDiff = diff;
      nearestPos = pos;
    }
  }
  return nearestPos;
}

export function posToMasterDb(pos: number): number {
  const clamped = Math.min(MASTER_VOLUME_MAX_POS, Math.max(0, Math.round(pos)));
  return MASTER_VOLUME_STEPS[clamped];
}

export function formatMasterDb(db: number): string {
  return db <= -127.5 ? '−∞' : db.toFixed(1);
}

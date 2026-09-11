import * as Clamp from '@/domain/clamp';
import type { ReadySession } from '@/state';
import { write, scrub } from './writes.svelte';

// Stereo upmixer (fw V25+, RP2350 only). Discrete mode/enable edits use the
// write lane; continuous knobs scrub, one lane key each.
export function setUpmixEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setUpmixEnabled(enabled),
    () => { s.mirror.snapshot.upmix.enabled = enabled; },
  );
}

export function setUpmixCenterMode(s: ReadySession, mode: number): void {
  void write(s,
    () => s.device.setUpmixCenterMode(mode),
    () => { s.mirror.snapshot.upmix.centerMode = mode; },
  );
}

export function setUpmixSurroundMode(s: ReadySession, mode: number): void {
  void write(s,
    () => s.device.setUpmixSurroundMode(mode),
    () => { s.mirror.snapshot.upmix.surroundMode = mode; },
  );
}

export function setUpmixStrength(s: ReadySession, pct: number): void {
  pct = Clamp.upmixStrengthPct(pct);
  scrub(s,
    'upmixStrength',
    () => { s.mirror.snapshot.upmix.strengthPct = pct; },
    () => s.device.setUpmixStrength(pct),
  );
}

export function setUpmixCenterWidth(s: ReadySession, pct: number): void {
  pct = Clamp.upmixCenterWidthPct(pct);
  scrub(s,
    'upmixCenterWidth',
    () => { s.mirror.snapshot.upmix.centerWidthPct = pct; },
    () => s.device.setUpmixCenterWidth(pct),
  );
}

export function setUpmixCorrThreshold(s: ReadySession, pct: number): void {
  pct = Clamp.upmixCorrThresholdPct(pct);
  scrub(s,
    'upmixCorrThreshold',
    () => { s.mirror.snapshot.upmix.corrThresholdPct = pct; },
    () => s.device.setUpmixCorrThreshold(pct),
  );
}

export function setUpmixAttack(s: ReadySession, ms: number): void {
  ms = Clamp.upmixAttackMs(ms);
  scrub(s,
    'upmixAttack',
    () => { s.mirror.snapshot.upmix.attackMs = ms; },
    () => s.device.setUpmixAttack(ms),
  );
}

export function setUpmixRelease(s: ReadySession, ms: number): void {
  ms = Clamp.upmixReleaseMs(ms);
  scrub(s,
    'upmixRelease',
    () => { s.mirror.snapshot.upmix.releaseMs = ms; },
    () => s.device.setUpmixRelease(ms),
  );
}

export function setUpmixDetectorHpf(s: ReadySession, hz: number): void {
  hz = Clamp.upmixDetectorHpfHz(hz);
  scrub(s,
    'upmixDetectorHpf',
    () => { s.mirror.snapshot.upmix.detectorHpfHz = hz; },
    () => s.device.setUpmixDetectorHpf(hz),
  );
}

export function setUpmixSurroundDelay(s: ReadySession, ms: number): void {
  ms = Clamp.upmixSurroundDelayMs(ms);
  scrub(s,
    'upmixSurroundDelay',
    () => { s.mirror.snapshot.upmix.surroundDelayMs = ms; },
    () => s.device.setUpmixSurroundDelay(ms),
  );
}

export function setUpmixSurroundHpf(s: ReadySession, hz: number): void {
  hz = Clamp.upmixSurroundHpfHz(hz);
  scrub(s,
    'upmixSurroundHpf',
    () => { s.mirror.snapshot.upmix.surroundHpfHz = hz; },
    () => s.device.setUpmixSurroundHpf(hz),
  );
}

export function setUpmixSurroundLpf(s: ReadySession, hz: number): void {
  hz = Clamp.upmixSurroundLpfHz(hz);
  scrub(s,
    'upmixSurroundLpf',
    () => { s.mirror.snapshot.upmix.surroundLpfHz = hz; },
    () => s.device.setUpmixSurroundLpf(hz),
  );
}

export function setUpmixDecorr(s: ReadySession, pct: number): void {
  pct = Clamp.upmixDecorrPct(pct);
  scrub(s,
    'upmixDecorr',
    () => { s.mirror.snapshot.upmix.decorrPct = pct; },
    () => s.device.setUpmixDecorr(pct),
  );
}

export function setUpmixPresence(s: ReadySession, db: number): void {
  db = Clamp.upmixPresenceDb(db);
  scrub(s,
    'upmixPresence',
    () => { s.mirror.snapshot.upmix.presenceDb = db; },
    () => s.device.setUpmixPresence(db),
  );
}

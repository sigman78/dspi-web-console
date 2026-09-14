import * as Domain from '@/domain';
import * as Clamp from '@/domain/clamp';
import type { ReadySession } from '@/state';
import { write, scrub } from './writes.svelte';
import { setInputPreamp } from './mixerActions';

export function setLoudnessEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setLoudnessEnabled(enabled),
    () => { s.mirror.snapshot.loudness.enabled = enabled; },
  );
}

export function setLoudnessRefSpl(s: ReadySession, db: number): void {
  db = Clamp.loudnessRefSpl(db);
  scrub(s,
    'loudnessRefSpl',
    () => { s.mirror.snapshot.loudness.refSpl = db; },
    () => s.device.setLoudnessRefSpl(db),
  );
}

export function setLoudnessIntensityPct(s: ReadySession, pct: number): void {
  pct = Clamp.loudnessIntensityPct(pct);
  scrub(s,
    'loudnessIntensity',
    () => { s.mirror.snapshot.loudness.intensityPct = pct; },
    () => s.device.setLoudnessIntensity(pct),
  );
}

// Per-output loudness mask (fw V19+): a single-channel toggle reads the
// current mask from the mirror, flips one bit, and re-sends the whole mask.
// Discrete edit -> write lane.
export function setLoudnessOutputMask(s: ReadySession, mask: number): void {
  mask &= 0xFFFF;
  void write(s,
    () => s.device.setLoudnessOutputMask(mask),
    () => { s.mirror.snapshot.loudness.outputMask = mask; },
  );
}

export function toggleLoudnessOutputChannel(s: ReadySession, ch: number): void {
  const mask = s.mirror.snapshot.loudness.outputMask ^ (1 << ch);
  setLoudnessOutputMask(s, mask);
}

export function setCrossfeedEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setCrossfeedEnabled(enabled),
    () => { s.mirror.snapshot.crossfeed.enabled = enabled; },
  );
}

export function setCrossfeedPreset(s: ReadySession, preset: Domain.CrossfeedPreset): void {
  void write(s,
    () => s.device.setCrossfeedPreset(preset),
    () => { s.mirror.snapshot.crossfeed.preset = preset; },
  );
}

export function setCrossfeedItd(s: ReadySession, itd: boolean): void {
  void write(s,
    () => s.device.setCrossfeedItd(itd),
    () => { s.mirror.snapshot.crossfeed.itd = itd; },
  );
}

export function setCrossfeedFreq(s: ReadySession, hz: number): void {
  hz = Clamp.crossfeedFreqHz(hz);
  scrub(s,
    'crossfeedFreq',
    () => { s.mirror.snapshot.crossfeed.freq = hz; },
    () => s.device.setCrossfeedFreq(hz),
  );
}

export function setCrossfeedFeedDb(s: ReadySession, db: number): void {
  db = Clamp.crossfeedFeedDb(db);
  scrub(s,
    'crossfeedFeedDb',
    () => { s.mirror.snapshot.crossfeed.feedDb = db; },
    () => s.device.setCrossfeedFeedDb(db),
  );
}

// Crossfeed output-pair mask (fw V20+): same single-command toggle pattern as
// the loudness output mask above. Discrete edit -> write lane.
export function setCrossfeedOutputPairs(s: ReadySession, mask: number): void {
  mask &= 0xFF;
  void write(s,
    () => s.device.setCrossfeedOutputPairs(mask),
    () => { s.mirror.snapshot.crossfeed.outputPairMask = mask; },
  );
}

export function toggleCrossfeedOutputPair(s: ReadySession, pair: number): void {
  const mask = s.mirror.snapshot.crossfeed.outputPairMask ^ (1 << pair);
  setCrossfeedOutputPairs(s, mask);
}

export function setLevellerEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setLevellerEnabled(enabled),
    () => { s.mirror.snapshot.leveller.enabled = enabled; },
  );
}

export function setLevellerSpeed(s: ReadySession, speed: Domain.LevellerSpeed): void {
  void write(s,
    () => s.device.setLevellerSpeed(speed),
    () => { s.mirror.snapshot.leveller.speed = speed; },
  );
}

export function setLevellerLookahead(s: ReadySession, lookahead: boolean): void {
  void write(s,
    () => s.device.setLevellerLookahead(lookahead),
    () => { s.mirror.snapshot.leveller.lookahead = lookahead; },
  );
}

export function setLevellerAmount(s: ReadySession, pct: number): void {
  pct = Clamp.levellerAmountPct(pct);
  scrub(s,
    'levellerAmount',
    () => { s.mirror.snapshot.leveller.amount = pct; },
    () => s.device.setLevellerAmount(pct),
  );
}

export function setLevellerMaxGain(s: ReadySession, db: number): void {
  db = Clamp.levellerMaxGainDb(db);
  scrub(s,
    'levellerMaxGain',
    () => { s.mirror.snapshot.leveller.maxGainDb = db; },
    () => s.device.setLevellerMaxGain(db),
  );
}

export function setLevellerGate(s: ReadySession, db: number): void {
  db = Clamp.levellerGateDb(db);
  scrub(s,
    'levellerGate',
    () => { s.mirror.snapshot.leveller.gateDb = db; },
    () => s.device.setLevellerGate(db),
  );
}

export function setPsybassEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setPsybassEnabled(enabled),
    () => { s.mirror.snapshot.psybass.enabled = enabled; },
  );
}

export function setPsybassCutoff(s: ReadySession, hz: number): void {
  hz = Clamp.psybassCutoffHz(hz);
  scrub(s,
    'psybassCutoff',
    () => { s.mirror.snapshot.psybass.cutoffHz = hz; },
    () => s.device.setPsybassCutoff(hz),
  );
}

export function setPsybassHarmonics(s: ReadySession, db: number): void {
  db = Clamp.psybassHarmonicsDb(db);
  scrub(s,
    'psybassHarmonics',
    () => { s.mirror.snapshot.psybass.harmonicsDb = db; },
    () => s.device.setPsybassHarmonics(db),
  );
}

export function setPsybassDrive(s: ReadySession, db: number): void {
  db = Clamp.psybassDriveDb(db);
  scrub(s,
    'psybassDrive',
    () => { s.mirror.snapshot.psybass.driveDb = db; },
    () => s.device.setPsybassDrive(db),
  );
}

export function setPsybassCharacter(s: ReadySession, pct: number): void {
  pct = Clamp.psybassCharacterPct(pct);
  scrub(s,
    'psybassCharacter',
    () => { s.mirror.snapshot.psybass.characterPct = pct; },
    () => s.device.setPsybassCharacter(pct),
  );
}

export function setPsybassOriginal(s: ReadySession, db: number): void {
  db = Clamp.psybassOriginalDb(db);
  scrub(s,
    'psybassOriginal',
    () => { s.mirror.snapshot.psybass.originalDb = db; },
    () => s.device.setPsybassOriginal(db),
  );
}

// Per-output psybass mask (fw V23+): same single-command toggle pattern as
// the loudness/crossfeed masks above. Discrete edit -> write lane.
export function setPsybassOutputMask(s: ReadySession, mask: number): void {
  mask &= 0xFFFF;
  void write(s,
    () => s.device.setPsybassMask(mask),
    () => { s.mirror.snapshot.psybass.outputMask = mask; },
  );
}

export function togglePsybassOutputChannel(s: ReadySession, ch: number): void {
  const mask = s.mirror.snapshot.psybass.outputMask ^ (1 << ch);
  setPsybassOutputMask(s, mask);
}

export function setSubharmEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setSubharmEnabled(enabled),
    () => {
      s.mirror.snapshot.subharm.enabled = enabled;
      // fw reports 0 while disabled; the poll stops. null = not read yet, so
      // re-enabling shows -- instead of a stale/false 0.0 until the next read.
      s.telemetry.subharmHeadroomDb = enabled ? null : 0;
      s.telemetry.requestSubharmRead();   // every subharm SET forces a headroom re-read
    },
  );
}

export function setSubharmLow(s: ReadySession, db: number): void {
  db = Clamp.subharmLevelDb(db);
  scrub(s,
    'subharmLow',
    () => {
      s.mirror.snapshot.subharm.lowDb = db;
      s.telemetry.requestSubharmRead();
    },
    () => s.device.setSubharmLow(db),
  );
}

export function setSubharmHigh(s: ReadySession, db: number): void {
  db = Clamp.subharmLevelDb(db);
  scrub(s,
    'subharmHigh',
    () => {
      s.mirror.snapshot.subharm.highDb = db;
      s.telemetry.requestSubharmRead();
    },
    () => s.device.setSubharmHigh(db),
  );
}

export function setSubharmBoost(s: ReadySession, db: number): void {
  db = Clamp.subharmBoostDb(db);
  scrub(s,
    'subharmBoost',
    () => {
      s.mirror.snapshot.subharm.boostDb = db;
      s.telemetry.requestSubharmRead();
    },
    () => s.device.setSubharmBoost(db),
  );
}

// Per-output subharm mask (fw V29+): same single-command toggle pattern as
// the loudness/crossfeed/psybass masks above. Discrete edit -> write lane.
export function setSubharmOutputMask(s: ReadySession, mask: number): void {
  mask &= 0xFFFF;
  void write(s,
    () => s.device.setSubharmMask(mask),
    () => { s.mirror.snapshot.subharm.outputMask = mask; },
  );
}

export function toggleSubharmOutputChannel(s: ReadySession, ch: number): void {
  const mask = s.mirror.snapshot.subharm.outputMask ^ (1 << ch);
  setSubharmOutputMask(s, mask);
}

// PR.06 RESERVE affordance: lowers each feeding input's preamp to exactly
// -headroomDb so the subharm boost can't clip downstream. No-op when there's
// nothing left to lower.
export function reserveSubharmHeadroom(s: ReadySession): void {
  const h = s.telemetry.subharmHeadroomDb ?? 0;
  const plan = Domain.subharmReservePlan(s.mirror.snapshot, h);
  for (const step of plan) setInputPreamp(s, step.slot, step.toDb);
}

// Multichannel leveller masks (fw V18+): both masks travel together in one
// command, so a single-channel toggle reads the current pair from the mirror,
// flips one bit, and re-sends both. Discrete edit -> write lane.
export function setLevellerMasks(s: ReadySession, detector: number, apply: number): void {
  detector &= 0xFF;
  apply &= 0xFF;
  void write(s,
    () => s.device.setLevellerMasks(detector, apply),
    () => {
      s.mirror.snapshot.leveller.detectorMask = detector;
      s.mirror.snapshot.leveller.applyMask = apply;
    },
  );
}

export function toggleLevellerDetectorChannel(s: ReadySession, ch: number): void {
  const detector = s.mirror.snapshot.leveller.detectorMask ^ (1 << ch);
  setLevellerMasks(s, detector, s.mirror.snapshot.leveller.applyMask);
}

export function toggleLevellerApplyChannel(s: ReadySession, ch: number): void {
  const apply = s.mirror.snapshot.leveller.applyMask ^ (1 << ch);
  setLevellerMasks(s, s.mirror.snapshot.leveller.detectorMask, apply);
}

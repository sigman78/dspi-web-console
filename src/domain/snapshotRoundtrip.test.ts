import { describe, it, expect } from 'vitest';
import { makeBulkObject } from '@test/fixtures/bulkFixtures';
import { buildBulkParams, parseBulkParams } from '@/protocol';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { createHardwareProfile, PlatformType, diffSnapshots, applyChange, type DspSnapshot } from '@/domain';
import type { BulkParams } from '@/protocol';

// Contract: applyChange(diffSnapshots(a, b)) over codec-real snapshots
// converges target to b exactly. Fixtures go through build->parse->decode so
// they carry every invariant the codec produces -- hand-built fixtures cannot.
const hw = createHardwareProfile(PlatformType.RP2350);

function decode(b: BulkParams): DspSnapshot {
  return fromBulkParams(hw, parseBulkParams(buildBulkParams(b)));
}

// V10 base so the optional tail sections (inputConfig/lgSoundSync/userVolume/
// dacHwMute) are present and diffable. Pins populated so outputPins is non-empty.
function makeBase(): BulkParams {
  return makeBulkObject({ formatVersion: 10, numPinOutputs: 5, pins: [6, 7, 8, 9, 10] });
}

const MUTATORS: Array<{ name: string; mutate: (b: BulkParams) => void }> = [
  { name: 'channel name',        mutate: (b) => { b.channelNames[3] = 'Sub'; } },
  { name: 'band gain',           mutate: (b) => { b.filters[2][1].gain += 3; } },
  { name: 'band type+freq',      mutate: (b) => { b.filters[0][0].type = 1; b.filters[0][0].frequency = 220; } },
  { name: 'output gain',         mutate: (b) => { b.outputs[1].gainDb = -6; } },
  { name: 'output enable+mute',  mutate: (b) => { b.outputs[2].enabled = !b.outputs[2].enabled; b.outputs[2].muted = !b.outputs[2].muted; } },
  { name: 'output delay',        mutate: (b) => { b.outputs[0].delayMs = 1.5; } },
  { name: 'crosspoint',          mutate: (b) => { b.crosspoints[1][2].gainDb = -3; b.crosspoints[1][2].enabled = true; } },
  { name: 'master volume',       mutate: (b) => { b.masterVolumeDb = -12; } },
  { name: 'master preamp',       mutate: (b) => { b.preampDb = -2; } },
  { name: 'input preamp',        mutate: (b) => { b.preampRDb = -4; } },
  { name: 'bypass',              mutate: (b) => { b.bypass = !b.bypass; } },
  { name: 'loudness',            mutate: (b) => { b.loudness.enabled = !b.loudness.enabled; b.loudness.intensityPct = 40; } },
  { name: 'crossfeed',           mutate: (b) => { b.crossfeed.enabled = !b.crossfeed.enabled; b.crossfeed.feedDb = -4; } },
  { name: 'leveller',            mutate: (b) => { b.leveller.amount = 55; b.leveller.gateDb = -50; } },
  { name: 'i2s output type',     mutate: (b) => { b.i2s.outputSlotTypes[1] = b.i2s.outputSlotTypes[1] === 0 ? 1 : 0; } },
  { name: 'i2s pins',            mutate: (b) => { b.i2s.bckPin += 2; } },
  { name: 'output pins',         mutate: (b) => { b.pins[0] += 2; } },
  { name: 'input config',        mutate: (b) => { b.inputConfig.source = 1; b.inputConfig.spdifRxPin = 7; } },
  { name: 'lg sound sync',       mutate: (b) => { b.lgSoundSync.enabled = !b.lgSoundSync.enabled; b.lgSoundSync.volume = 30; } },
  { name: 'user volume',         mutate: (b) => { b.userVolume.volumeDb = -10; b.userVolume.mute = !b.userVolume.mute; } },
  { name: 'dac hw mute',         mutate: (b) => { b.dacHwMute.enabled = !b.dacHwMute.enabled; b.dacHwMute.holdMs = 100; } },
];

describe('diff/apply round-trip over codec-real snapshots', () => {
  for (const m of MUTATORS) {
    it(`converges: ${m.name}`, () => {
      const base = makeBase();
      const before = decode(base);
      const mutated = structuredClone(base);
      m.mutate(mutated);
      const after = decode(mutated);
      const target = structuredClone(before);
      for (const c of diffSnapshots(before, after)) applyChange(c, target);
      expect(target).toEqual(after);
    });
  }
});

import { describe, it, expect } from 'vitest';
import * as Domain from '@/domain';
import type { CsCaps, CsIrCommand, CsNounCaps } from '@/domain';
import * as CsIr from './irDraft';
import { csCapsV3, csNouns, disabledNoun } from '@test/fixtures/csCaps';

const nouns: CsNounCaps[] = [
  csNouns[Domain.CsNoun.UserVolume],                                                      // 0
  disabledNoun,                                                                    // 1
  csNouns[Domain.CsNoun.UserMute],                                                        // 2
  ...Array(3).fill(disabledNoun),                                                  // 3..5
  csNouns[Domain.CsNoun.Preset],                                                          // 6
  ...Array(13).fill(disabledNoun),                                                 // 7..19
  csNouns[Domain.CsNoun.FilterFreq],                                                      // 20
];

const caps9: CsCaps = { ...csCapsV3, capsVersion: 9, maxGroups: 8 };
const caps10: CsCaps = { ...caps9, capsVersion: 10 };

function ir(over: Partial<CsIrCommand>): CsIrCommand {
  return { ...Domain.EMPTY_CS_IR_COMMAND, protocol: Domain.CsIrProto.Nec, code: 0x00FF18E7, ...over };
}

function roundTrip(c: CsIrCommand, caps: CsCaps = csCapsV3): CsIrCommand {
  return CsIr.buildIrCommand(CsIr.irDraftFromLive(c, nouns), nouns, caps);
}

// A learned command turned into a draft and rebuilt must equal the original,
// or every untouched sub-slot would read as dirty.
describe('IR draft round-trip', () => {
  it('reproduces a Set command with a dB value', () => {
    const c = ir({ noun: Domain.CsNoun.UserVolume, action: Domain.CsAction.Set, value: -3200 });
    expect(CsIr.irCommandsEqual(roundTrip(c), c)).toBe(true);
  });

  it('reproduces an Inc command on a Hz band noun with an octave step', () => {
    const c = ir({ noun: Domain.CsNoun.FilterFreq, action: Domain.CsAction.Inc, target: 3, index: 2, step: 128 });
    expect(CsIr.irCommandsEqual(roundTrip(c), c)).toBe(true);
  });

  it('keeps a grouped target only from caps v10', () => {
    const c = ir({ noun: Domain.CsNoun.FilterFreq, action: Domain.CsAction.Inc, target: 1, step: 128, flags: Domain.CS_FLAG_GROUP });
    expect(roundTrip(c, caps10).flags & Domain.CS_FLAG_GROUP).toBe(Domain.CS_FLAG_GROUP);
    expect(roundTrip(c, caps9).flags & Domain.CS_FLAG_GROUP).toBe(0);
  });
});

describe('buildIrCommand conditional encoding', () => {
  it('drops WRAP on a non-enum noun and REPEAT on a non-step action', () => {
    const wrapOnDb = CsIr.buildIrCommand({
      ...CsIr.irDraftFromLive(ir({ noun: Domain.CsNoun.UserVolume, action: Domain.CsAction.Inc, step: 256 }), nouns), wrap: true,
    }, nouns, csCapsV3);
    expect(wrapOnDb.flags & Domain.CS_FLAG_WRAP).toBe(0);

    const repeatOnSet = CsIr.buildIrCommand({
      ...CsIr.irDraftFromLive(ir({ noun: Domain.CsNoun.UserMute, action: Domain.CsAction.Set, value: 1 }), nouns), repeat: true,
    }, nouns, csCapsV3);
    expect(repeatOnSet.flags & Domain.CS_FLAG_REPEAT).toBe(0);
  });

  it('zeroes the operands PAGE_VALUE does not carry', () => {
    const pageNouns = nouns.slice();
    pageNouns[Domain.CsNoun.PageValue] = csNouns[Domain.CsNoun.UserVolume];
    const c = CsIr.buildIrCommand({
      ...CsIr.irDraftFromLive(ir({ noun: Domain.CsNoun.PageValue, action: Domain.CsAction.Inc }), pageNouns), value: 5, step: 2,
    }, pageNouns, csCapsV3);
    expect(c.value).toBe(0);
    expect(c.step).toBe(0);
  });
});

describe('IR option lists', () => {
  it('offers only nouns and actions the IR type descriptor allows', () => {
    const irActions = csCapsV3.types[7].actions;
    for (const n of CsIr.irNounOptions(csCapsV3, nouns)) expect(nouns[n].actions & irActions).not.toBe(0);
    for (const a of CsIr.irActionOptions(csCapsV3, nouns, Domain.CsNoun.UserVolume)) {
      expect(irActions & (1 << a)).not.toBe(0);
    }
  });

  it('seeds a default draft with a legal action and no learned code', () => {
    const d = CsIr.defaultIrDraft(csCapsV3, nouns);
    expect(CsIr.irActionOptions(csCapsV3, nouns, d.noun)).toContain(d.action);
    expect(d.protocol).toBe(Domain.CsIrProto.None);
  });
});

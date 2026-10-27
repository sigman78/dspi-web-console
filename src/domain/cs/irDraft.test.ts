import { describe, it, expect } from 'vitest';
import {
  CsNoun, CsAction, CsIrProto,
  CS_FLAG_GROUP, CS_FLAG_WRAP, CS_FLAG_REPEAT,
  EMPTY_CS_IR_COMMAND,
  type CsCaps, type CsIrCommand, type CsNounCaps,
} from '@/domain';
import {
  buildIrCommand, irCommandsEqual, irDraftFromLive, defaultIrDraft, irNounOptions, irActionOptions,
} from './irDraft';
import { csCapsV3, csNouns, disabledNoun } from '@test/fixtures/csCaps';

const nouns: CsNounCaps[] = [
  csNouns[CsNoun.UserVolume],                                                      // 0
  disabledNoun,                                                                    // 1
  csNouns[CsNoun.UserMute],                                                        // 2
  ...Array(3).fill(disabledNoun),                                                  // 3..5
  csNouns[CsNoun.Preset],                                                          // 6
  ...Array(13).fill(disabledNoun),                                                 // 7..19
  csNouns[CsNoun.FilterFreq],                                                      // 20
];

const caps9: CsCaps = { ...csCapsV3, capsVersion: 9, maxGroups: 8 };
const caps10: CsCaps = { ...caps9, capsVersion: 10 };

function ir(over: Partial<CsIrCommand>): CsIrCommand {
  return { ...EMPTY_CS_IR_COMMAND, protocol: CsIrProto.Nec, code: 0x00FF18E7, ...over };
}

function roundTrip(c: CsIrCommand, caps: CsCaps = csCapsV3): CsIrCommand {
  return buildIrCommand(irDraftFromLive(c, nouns), nouns, caps);
}

// A learned command turned into a draft and rebuilt must equal the original,
// or every untouched sub-slot would read as dirty.
describe('IR draft round-trip', () => {
  it('reproduces a Set command with a dB value', () => {
    const c = ir({ noun: CsNoun.UserVolume, action: CsAction.Set, value: -3200 });
    expect(irCommandsEqual(roundTrip(c), c)).toBe(true);
  });

  it('reproduces an Inc command on a Hz band noun with an octave step', () => {
    const c = ir({ noun: CsNoun.FilterFreq, action: CsAction.Inc, target: 3, index: 2, step: 128 });
    expect(irCommandsEqual(roundTrip(c), c)).toBe(true);
  });

  it('keeps a grouped target only from caps v10', () => {
    const c = ir({ noun: CsNoun.FilterFreq, action: CsAction.Inc, target: 1, step: 128, flags: CS_FLAG_GROUP });
    expect(roundTrip(c, caps10).flags & CS_FLAG_GROUP).toBe(CS_FLAG_GROUP);
    expect(roundTrip(c, caps9).flags & CS_FLAG_GROUP).toBe(0);
  });
});

describe('buildIrCommand conditional encoding', () => {
  it('drops WRAP on a non-enum noun and REPEAT on a non-step action', () => {
    const wrapOnDb = buildIrCommand({
      ...irDraftFromLive(ir({ noun: CsNoun.UserVolume, action: CsAction.Inc, step: 256 }), nouns), wrap: true,
    }, nouns, csCapsV3);
    expect(wrapOnDb.flags & CS_FLAG_WRAP).toBe(0);

    const repeatOnSet = buildIrCommand({
      ...irDraftFromLive(ir({ noun: CsNoun.UserMute, action: CsAction.Set, value: 1 }), nouns), repeat: true,
    }, nouns, csCapsV3);
    expect(repeatOnSet.flags & CS_FLAG_REPEAT).toBe(0);
  });

  it('zeroes the operands PAGE_VALUE does not carry', () => {
    const pageNouns = nouns.slice();
    pageNouns[CsNoun.PageValue] = csNouns[CsNoun.UserVolume];
    const c = buildIrCommand({
      ...irDraftFromLive(ir({ noun: CsNoun.PageValue, action: CsAction.Inc }), pageNouns), value: 5, step: 2,
    }, pageNouns, csCapsV3);
    expect(c.value).toBe(0);
    expect(c.step).toBe(0);
  });
});

describe('IR option lists', () => {
  it('offers only nouns and actions the IR type descriptor allows', () => {
    const irActions = csCapsV3.types[7].actions;
    for (const n of irNounOptions(csCapsV3, nouns)) expect(nouns[n].actions & irActions).not.toBe(0);
    for (const a of irActionOptions(csCapsV3, nouns, CsNoun.UserVolume)) {
      expect(irActions & (1 << a)).not.toBe(0);
    }
  });

  it('seeds a default draft with a legal action and no learned code', () => {
    const d = defaultIrDraft(csCapsV3, nouns);
    expect(irActionOptions(csCapsV3, nouns, d.noun)).toContain(d.action);
    expect(d.protocol).toBe(CsIrProto.None);
  });
});

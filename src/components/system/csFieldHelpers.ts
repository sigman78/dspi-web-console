// Noun-shape lookups and option lists shared by every CS editor (bindings,
// IR commands, macro steps, display pages, groups): each edits a
// (noun, action, target/index, value/step) tuple against the same CsNounDesc
// caps table, wrapped in a different container. Explicit-arg so each caller
// passes its own draft shape instead of sharing one.
import * as Domain from '@/domain';

export function kindOf(nouns: readonly Domain.CsNounCaps[], noun: number): number {
  return nouns[noun]?.kind ?? Domain.CsKind.Bool;
}
export function contOf(nouns: readonly Domain.CsNounCaps[], noun: number): boolean {
  return kindOf(nouns, noun) === Domain.CsKind.Continuous;
}
export function enumOf(nouns: readonly Domain.CsNounCaps[], noun: number): boolean {
  return kindOf(nouns, noun) === Domain.CsKind.Enum;
}
export function unitOf(nouns: readonly Domain.CsNounCaps[], noun: number): number {
  return nouns[noun]?.unit ?? Domain.CS_UNIT_NONE;
}
export function targetKindOf(nouns: readonly Domain.CsNounCaps[], noun: number): number {
  return nouns[noun]?.targetKind ?? Domain.CS_TARGET_NONE;
}

export function showValueOf(action: number): boolean {
  return action === Domain.CsAction.Set || action === Domain.CsAction.IndEquals
    || action === Domain.CsAction.IndAbove || action === Domain.CsAction.Momentary;
}
export function showStepOf(action: number, steppy: readonly number[]): boolean {
  return steppy.includes(action);
}
export function showWrapOf(nouns: readonly Domain.CsNounCaps[], noun: number, action: number, steppy: readonly number[]): boolean {
  return enumOf(nouns, noun) && steppy.includes(action);
}
export function showTargetOf(nouns: readonly Domain.CsNounCaps[], noun: number): boolean {
  return targetKindOf(nouns, noun) !== Domain.CS_TARGET_NONE;
}
export function showBandOf(nouns: readonly Domain.CsNounCaps[], noun: number): boolean {
  return targetKindOf(nouns, noun) === Domain.CS_TARGET_DSP_BAND;
}

export function valueLabel(action: number, cont: boolean, noun: number): string {
  if (noun === Domain.CsNoun.Macro) {
    if (action === Domain.CsAction.Set) return 'FIRE';
    if (action === Domain.CsAction.IndEquals) return 'LIT WHILE RUNNING';
  }
  if (action === Domain.CsAction.IndEquals) return 'LIGHT WHEN';
  if (action === Domain.CsAction.IndAbove) return 'LIGHT WHEN ≥';
  if (action === Domain.CsAction.Momentary) return 'WHILE HELD';
  return cont ? 'TARGET LEVEL' : 'SET TO';
}

export function boolValueOptions(noun: number): { v: number; label: string }[] {
  const clip = noun === Domain.CsNoun.Clip;
  return [
    { v: 1, label: clip ? 'Clipping' : 'On' },
    { v: 0, label: clip ? 'Not clipping' : 'Off' },
  ];
}

// Crossfeed voicing and leveller-speed enum labels (the CROSSFEED_PRESET/
// LEVELLER_SPEED nouns don't identify curve names; same generic labels the
// console's other Crossfeed/Leveller panels use).
const CROSSFEED_PRESET_LABEL: Record<number, string> = {
  [Domain.CrossfeedPreset.Preset1]: 'Preset 1',
  [Domain.CrossfeedPreset.Preset2]: 'Preset 2',
  [Domain.CrossfeedPreset.Preset3]: 'Preset 3',
  [Domain.CrossfeedPreset.Custom]:  'Custom',
};
const LEVELLER_SPEED_LABEL: Record<number, string> = {
  [Domain.LevellerSpeed.Slow]:   'Slow',
  [Domain.LevellerSpeed.Medium]: 'Medium',
  [Domain.LevellerSpeed.Fast]:   'Fast',
};
const SAMPLE_RATE_LABEL: Record<number, string> = { 0: '44.1 kHz', 1: '48 kHz', 2: '96 kHz' };

export function enumValueOptions(
  nouns: readonly Domain.CsNounCaps[], noun: number, presetNames: readonly (string | null)[],
  macros: readonly (Domain.CsMacro | null)[] = [], displayPages: readonly (Domain.CsDisplayPage | null)[] = [],
): { v: number; label: string }[] {
  const count = nouns[noun]?.enumCount ?? 0;
  const idx = Array.from({ length: count }, (_, i) => i);
  if (noun === Domain.CsNoun.Preset) {
    return idx.map((i) => {
      const name = presetNames[i];
      return { v: i, label: `Preset ${i + 1}${name ? ` · ${name}` : ''}` };
    });
  }
  if (noun === Domain.CsNoun.Macro) {
    return idx.map((i) => {
      const name = macros[i]?.name;
      return { v: i, label: `Macro ${i + 1}${name ? ` · ${name}` : ''}` };
    });
  }
  if (noun === Domain.CsNoun.DisplayPage) {
    return idx.map((i) => {
      const p = displayPages[i];
      return { v: i, label: `Page ${i + 1}${p ? ` · ${Domain.csNounLabel(p.noun)}` : ''}` };
    });
  }
  if (noun === Domain.CsNoun.InputSource) {
    const names = ['USB', 'S/PDIF', 'I2S'];
    return idx.map((i) => ({ v: i, label: names[i] ?? String(i) }));
  }
  if (noun === Domain.CsNoun.CrossfeedPreset) return idx.map((i) => ({ v: i, label: CROSSFEED_PRESET_LABEL[i] ?? String(i) }));
  if (noun === Domain.CsNoun.LevellerSpeed) return idx.map((i) => ({ v: i, label: LEVELLER_SPEED_LABEL[i] ?? String(i) }));
  if (noun === Domain.CsNoun.SampleRate) return idx.map((i) => ({ v: i, label: SAMPLE_RATE_LABEL[i] ?? String(i) }));
  if (noun === Domain.CsNoun.UpmixCenterMode) return idx.map((i) => ({ v: i, label: ['Passive', 'Logic', 'Off'][i] ?? String(i) }));
  if (noun === Domain.CsNoun.UpmixSurroundMode) return idx.map((i) => ({ v: i, label: ['Off', 'Passive', 'Logic'][i] ?? String(i) }));
  return idx.map((i) => ({ v: i, label: String(i) }));
}

// Target/band pickers. INPUT_CH/OUTPUT_CH index into the platform's input or
// output channel list; DSP_CH/DSP_BAND index into the combined (inputs then
// outputs) list, matching the firmware's addressing and snap.channels' order.
export function targetOptionsFor(
  nouns: readonly Domain.CsNounCaps[], noun: number, channels: readonly Domain.ChannelModel[],
): { v: number; label: string }[] {
  const kind = targetKindOf(nouns, noun);
  const count = nouns[noun]?.targetCount ?? 0;
  let opts: { v: number; label: string }[];
  switch (kind) {
    case Domain.CS_TARGET_INPUT_CH:
      opts = channels.filter((c) => !c.isOutput).map((c, i) => ({ v: i, label: c.name }));
      break;
    case Domain.CS_TARGET_OUTPUT_CH:
      opts = channels.filter((c) => c.isOutput).map((c, i) => ({ v: i, label: c.name }));
      break;
    case Domain.CS_TARGET_DSP_CH:
    case Domain.CS_TARGET_DSP_BAND:
      opts = channels.map((c, i) => ({ v: i, label: c.name }));
      break;
    default:
      opts = [];
  }
  return opts.filter((o) => o.v < count);
}

// Valid bands for the selected channel: PEQ bands 1..bandCount, plus (only
// for FILTER_FREQ/FILTER_BYPASS, output channels only) the crossover bands
// at wire indices XOVER_BAND_BASE.. (see control_surfaces_spec.md 4.4).
export function bandOptionsFor(
  noun: number, target: number, channels: readonly Domain.ChannelModel[],
): { v: number; label: string }[] {
  const ch = channels[target];
  if (!ch) return [];
  const opts: { v: number; label: string }[] = [];
  for (let i = 0; i < ch.bandCount; i++) opts.push({ v: i, label: `Band ${i + 1}` });
  const allowsXover = noun === Domain.CsNoun.FilterFreq || noun === Domain.CsNoun.FilterBypass;
  if (allowsXover && ch.isOutput) {
    for (let i = 0; i < ch.xoverBands.length; i++) opts.push({ v: Domain.XOVER_BAND_BASE + i, label: `XO ${i + 1}` });
  }
  return opts;
}

// Target groups exist from caps v9; a device also has to report a non-zero
// ceiling for the panel/pickers to offer them.
export function groupsAvailable(caps: Domain.CsCaps | null): boolean {
  return (caps?.capsVersion ?? 0) >= 9 && (caps?.maxGroups ?? 0) > 0;
}

// Macros exist from caps v9, same convention as groupsAvailable.
export function macrosAvailable(caps: Domain.CsCaps | null): boolean {
  return (caps?.capsVersion ?? 0) >= 9 && (caps?.maxMacros ?? 0) > 0;
}

export function displaysAvailable(caps: Domain.CsCaps | null): boolean {
  return Domain.csDisplaysAvailable(caps);
}

// The I2C control interface's live bus instance, if it's enabled -- a
// display can't share that instance (fw I2C_IN_USE / the symmetric
// PIN_IN_USE on the interface). Shared by the binding row and the panel's
// own default-draft pin picks.
export function liveI2cInstance(i2c: { enabled: boolean; sdaPin: number } | null | undefined): number | null {
  return i2c?.enabled ? Domain.i2cInstance(i2c.sdaPin) : null;
}

// Nouns a display page may show: platform-available (a noun mask reading 0
// is unavailable on this build) and a unit this console knows how to render,
// minus the three display-only nouns a page can't recurse into.
export function pageNounOptions(nouns: readonly Domain.CsNounCaps[]): { v: number; label: string }[] {
  const out: { v: number; label: string }[] = [];
  nouns.forEach((n, i) => {
    if (n.actions === 0 || n.unit > Domain.CS_MAX_KNOWN_UNIT) return;
    if (i === Domain.CsNoun.DisplayPage || i === Domain.CsNoun.DisplayEdit || i === Domain.CsNoun.PageValue) return;
    out.push({ v: i, label: Domain.csNounLabel(i) });
  });
  return out;
}

// Groups a binding/IR command may target instead of a single channel: only
// non-empty groups whose kind matches the noun's own target space (see
// Domain.csGroupKindForNoun).
export function groupOptionsFor(
  nouns: readonly Domain.CsNounCaps[], noun: number, groups: readonly (Domain.CsGroup | null)[],
): { v: number; label: string }[] {
  const wantKind = Domain.csGroupKindForNoun(nouns[noun]);
  const opts: { v: number; label: string }[] = [];
  groups.forEach((g, i) => {
    if (g && g.targetKind === wantKind) opts.push({ v: i, label: `Group ${i + 1}${g.name ? ` · ${g.name}` : ''}` });
  });
  return opts;
}

// The member-picker chip list for a group of the given kind, same channel
// ordering (and index space) as targetOptionsFor.
export function groupMemberItems(
  kind: number, channels: readonly Domain.ChannelModel[],
): { key: number; index: number; label: string; title: string }[] {
  let list: readonly Domain.ChannelModel[];
  switch (kind) {
    case Domain.CS_TARGET_INPUT_CH:  list = channels.filter((c) => !c.isOutput); break;
    case Domain.CS_TARGET_OUTPUT_CH: list = channels.filter((c) => c.isOutput); break;
    case Domain.CS_TARGET_DSP_CH:    list = channels; break;
    default:                         list = [];
  }
  return list.map((c, i) => ({ key: i, index: i, label: String(i + 1), title: c.name }));
}

// A grouped DSP_BAND noun's band options: only bands valid on EVERY member
// inside the noun's addressing range (mirrors fw's per-member band check
// after its mask-and-limit). Empty group -> no bands.
export function groupBandOptionsFor(
  nouns: readonly Domain.CsNounCaps[], noun: number, group: Domain.CsGroup, channels: readonly Domain.ChannelModel[],
): { v: number; label: string }[] {
  const nounCaps = nouns[noun];
  if (!nounCaps) return [];
  const mask = Domain.csGroupMembers(group, nounCaps);
  let result: { v: number; label: string }[] | null = null;
  for (let m = 0; m < 32; m++) {
    if (!(mask & (1 << m))) continue;
    const opts = bandOptionsFor(noun, m, channels);
    const values = new Set(opts.map((o) => o.v));
    result = result === null ? opts : result.filter((o) => values.has(o.v));
  }
  return result ?? [];
}

// Live channel counts for validateCsGroup's client-side bounds check.
export function csChannelCounts(channels: readonly Domain.ChannelModel[]): Domain.CsChannelCounts {
  const outputs = channels.filter((c) => c.isOutput).length;
  return { inputs: channels.length - outputs, outputs, dsp: channels.length };
}

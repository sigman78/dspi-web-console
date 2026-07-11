// Noun-shape lookups and option lists shared between the binding editor
// (ControlSurfacesPanel) and the IR command editor (CsIrCommands): both edit
// a (noun, action, target/index, value/step) tuple against the same
// CsNounDesc caps table, just wrapped in a different container (a GPIO
// binding vs. a learned IR command). Explicit-arg so both callers can pass
// their own draft shape instead of sharing one.
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

export function valueLabel(action: number, cont: boolean): string {
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
): { v: number; label: string }[] {
  const count = nouns[noun]?.enumCount ?? 0;
  const idx = Array.from({ length: count }, (_, i) => i);
  if (noun === Domain.CsNoun.Preset) {
    return idx.map((i) => {
      const name = presetNames[i];
      return { v: i, label: `Preset ${i + 1}${name ? ` · ${name}` : ''}` };
    });
  }
  if (noun === Domain.CsNoun.InputSource) {
    const names = ['USB', 'S/PDIF', 'I2S'];
    return idx.map((i) => ({ v: i, label: names[i] ?? String(i) }));
  }
  if (noun === Domain.CsNoun.CrossfeedPreset) return idx.map((i) => ({ v: i, label: CROSSFEED_PRESET_LABEL[i] ?? String(i) }));
  if (noun === Domain.CsNoun.LevellerSpeed) return idx.map((i) => ({ v: i, label: LEVELLER_SPEED_LABEL[i] ?? String(i) }));
  if (noun === Domain.CsNoun.SampleRate) return idx.map((i) => ({ v: i, label: SAMPLE_RATE_LABEL[i] ?? String(i) }));
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

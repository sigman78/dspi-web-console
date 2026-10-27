export type ProgramModuleKey =
  | 'preamp'
  | 'inputEq'
  | 'leveller'
  | 'crossfeed'
  | 'loudness'
  | 'psybass'
  | 'subharm'
  | 'upmix';

/** Strip anchors: shown in the chain but not selectable modules. */
export type ChainAnchorKey = 'matrix' | 'outputs';

const GATED: Partial<Record<ProgramModuleKey, 'psybass' | 'subharm' | 'upmix'>> = {
  psybass: 'psybass',
  subharm: 'subharm',
  upmix: 'upmix',
};

/** The stored selection, or the first chain module (preamp) when firmware lacks its feature. */
export function resolveModule(
  key: ProgramModuleKey,
  features: Record<'psybass' | 'subharm' | 'upmix', boolean>,
): ProgramModuleKey {
  const gate = GATED[key];
  return gate && !features[gate] ? 'preamp' : key;
}

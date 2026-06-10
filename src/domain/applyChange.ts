// Apply one SnapshotChange to a DspSnapshot in place; inverse of diffSnapshots.
// Aggregate kinds replace the whole object (reactive under a Svelte deep proxy).
// Exhaustive switch -- TypeScript flags any unhandled kind.

import type { DspSnapshot } from './snapshot';
import type { SnapshotChange } from './snapshotDiff';

export function applyChange(c: SnapshotChange, t: DspSnapshot): void {
  switch (c.kind) {
    case 'bypass':            t.bypass = c.value; break;
    case 'masterPreamp':      t.masterPreampDb = c.value; break;
    case 'inputPreamp':       t.inputPreampDb[c.channel] = c.value; break;
    case 'masterVolume':      t.masterVolumeDb = c.value; break;
    case 'channelName':       t.channels[c.channelIndex].name = c.value; break;
    case 'band':              t.channels[c.channelIndex].filters[c.band] = c.value; break;
    case 'output':            t.outputs[c.index] = c.value; break;
    case 'route':             t.routes[c.index] = c.value; break;
    case 'loudness':          t.loudness = c.value; break;
    case 'crossfeed':         t.crossfeed = c.value; break;
    case 'leveller':          t.leveller = c.value; break;
    case 'inputConfig':       t.inputConfig = c.value; break;
    case 'userVolume':        t.userVolume = c.value; break;
    case 'dacHwMute':         t.dacHwMute = c.value; break;
    case 'i2s':               t.i2s = c.value; break;
    case 'outputPins':        t.outputPins = c.value; break;
    case 'lgSoundSyncEnabled': if (t.lgSoundSync) t.lgSoundSync.enabled = c.value; break;
    case 'lgSoundSyncStatus':
      if (t.lgSoundSync) {
        t.lgSoundSync.present = c.value.present;
        t.lgSoundSync.volume = c.value.volume;
        t.lgSoundSync.muted = c.value.muted;
      }
      break;
  }
}

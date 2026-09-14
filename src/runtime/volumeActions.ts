import * as Domain from '@/domain';
import * as Clamp from '@/domain/clamp';
import { type ReadySession, pushNotice } from '@/state';
import { write, scrub, command } from './writes.svelte';

export function setBypass(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setBypass(enabled),
    () => { s.mirror.snapshot.bypass = enabled; },
  );
}

export function setMasterVolume(s: ReadySession, db: number): void {
  db = Clamp.masterVolumeDb(db);
  scrub(s,
    'masterVolume',
    () => { s.mirror.snapshot.masterVolumeDb = db; },
    () => s.device.setMasterVolume(db),
  );
}

// User volume axis (0xDA): firmware quantizes to whole dB. The OS volume
// slider writes this same field over UAC1 while USB is the active input;
// source-tagged notifies and the safety-net poll reconcile the two writers.
export function setUserVolume(s: ReadySession, db: number): void {
  db = Clamp.userVolumeDb(db);
  scrub(s,
    'userVolume',
    () => { s.mirror.snapshot.userVolume.volumeDb = db; },
    () => s.device.setUserVolume(db),
  );
}

// Flips the firmware vendor user-mute bit (0xDC). The firmware ORs this with
// the UAC1 OS mute — they're independent; we reflect and control only this bit.
export function toggleMute(s: ReadySession): void {
  setUserMute(s, !s.mirror.snapshot.userVolume.mute);
}

export function setMasterVolumeMode(s: ReadySession, mode: Domain.MasterVolumeMode): void {
  void command(s,'set master volume mode', () => s.device.setMasterVolumeMode(mode), () => {
    if (s.presets.directory) s.presets.directory = { ...s.presets.directory, masterVolumeMode: mode };
  });
}

// 0xD6 SaveMasterVolume -- writes the directory's boot-baseline volume. In Mode 0
// this is the post-boot starting volume; in Mode 1 firmware accepts the call but
// it stays dormant until the user flips back to Mode 0. Fire-and-forget: only
// failure surfaces; success is silent (the Save button's state conveys it).
export function saveMasterVolumeBaseline(s: ReadySession): void {
  void command(s,'save master volume', () => s.device.saveMasterVolume(), (r) => {
    if (!r.ok) { pushNotice('warn', `Saving master volume failed (${r.message ?? 'flash error'}).`); return; }
    // Mirror the saved baseline so the Save button settles to clean without a refetch.
    s.presets.savedMasterVolumeDb = s.mirror.snapshot.masterVolumeDb;
  });
}

export function setUserMute(s: ReadySession, mute: boolean): void {
  void write(s,
    () => s.device.setUserMute(mute),
    () => { s.mirror.snapshot.userVolume.mute = mute; },
  );
}

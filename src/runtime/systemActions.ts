import * as Domain from '@/domain';
import * as Clamp from '@/domain/clamp';
import { type ReadySession, pushNotice } from '@/state';
import { errMessage } from '@/utils';
import { write, command } from './writes.svelte';

// Clears firmware-side latched clip flags (0x83) and the host-side OR-latch.
// Not routed through write/scrub: clip state lives in telemetry, not the DSP
// snapshot, so the post-send resync would be pure overhead. On send failure the
// host array stays cleared; the next poll re-latches from clipFlags if firmware
// still sees the condition.
export function clearClips(s: ReadySession): void {
  for (let i = 0; i < s.telemetry.clipLatched.length; i++) s.telemetry.clipLatched[i] = false;
  void command(s, 'clear clips', () => s.device.clearClips(), () => {});
}

// M7 — LG Sound Sync enable toggle.
export function setLgSoundSyncEnabled(s: ReadySession, enabled: boolean): void {
  void write(s,
    () => s.device.setLgSoundSyncEnabled(enabled),
    () => { s.mirror.snapshot.lgSoundSync.enabled = enabled; },
  );
}

// M6 — DAC HW mute config. The wire takes the whole struct, so the verb takes
// a partial and merges over the live mirror optimistically BEFORE sending:
// a second edit inside the first ack window then builds on the first instead
// of silently reverting it from a stale captured struct.
//
// The firmware applies the struct in a deferred handler that SWALLOWS
// validation failures (bad pin / collision / hold_ms out of [1,500]); its own
// contract says hosts must read the config back to learn the verdict. So the
// verb clamps the timings, waits out the deferred apply, reads the echo back
// as device truth, and warns when an enable didn't stick.
const DAC_HW_MUTE_APPLY_MS = 200;

export function setDacHwMute(s: ReadySession, patch: Partial<Domain.DacHwMute>): void {
  const merged = { ...s.mirror.snapshot.dacHwMute, ...patch };
  const next: Domain.DacHwMute = merged.enabled
    ? { ...merged, holdMs: Clamp.dacHwMuteHoldMs(merged.holdMs), releaseMs: Clamp.dacHwMuteReleaseMs(merged.releaseMs) }
    : merged;
  s.mirror.snapshot.dacHwMute = next;
  // queued: false -- the apply wait must not hold the session queue (it would
  // stall the status poll); each wire call queues itself and the wait sits
  // between them.
  void command(s, 'set DAC HW mute', async () => {
    await s.queue.run(() => s.device.setDacHwMute(next));
    await new Promise((r) => setTimeout(r, DAC_HW_MUTE_APPLY_MS));
    return s.queue.run(() => s.device.getDacHwMute());
  }, (echo, s) => {
    s.mirror.snapshot.dacHwMute = echo;
    if (next.enabled && (echo.enabled !== next.enabled || echo.pin !== next.pin)) {
      pushNotice('warn', 'DAC HW mute config rejected by the device (pin in use or invalid).');
    }
    s.mirror.requestReconcile(false);
  }, { queued: false });
}

// Selectable system clock (fw overclock branch). SET is a deferred apply --
// firmware persists first, then tears down and rebuilds audio around the
// vreg+PLL step -- so a GET right after SET may still report the old
// activeMode. The confirm loop polls a few times so the panel shows live
// progress instead of a single stale readback; it stops early once the
// device reports the requested mode active. Not part of the bulk packet, so
// a failure never resyncs the mirror -- the command() lane's own error
// handling (toast + health.noteFail) is all a STALL needs.
const SYS_CLOCK_APPLY_MS = 500;
const SYS_CLOCK_CONFIRM_ATTEMPTS = 3;

export async function applySysClock(s: ReadySession, mode: Domain.SysClockMode, vregSel: number): Promise<void> {
  s.sysClock.busy = true;
  try {
    await command(s, 'set system clock', async () => {
      const d = s.device;
      await s.queue.run(() => d.setSysClock(mode, vregSel));
      let status: Domain.SysClockStatus | null = null;
      for (let i = 0; i < SYS_CLOCK_CONFIRM_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, SYS_CLOCK_APPLY_MS));
        status = await s.queue.run(() => d.getSysClock());
        if (s.alive) s.sysClock.status = status;
        // A fresh SET clears the fallback latch, so a readback that still
        // carries it predates the apply -- keep polling.
        if (status.activeMode === mode && !status.fallbackActive) break;
      }
      return status;
    }, (status) => {
      if (status && status.activeMode !== mode && !status.fallbackActive) {
        pushNotice('warn', 'System clock switch has not been confirmed yet — the device may still be applying it.');
      }
    }, { queued: false });
  } finally {
    s.sysClock.busy = false;
  }
}

// Manual re-read for the panel's REFRESH affordance -- the escape hatch when
// a deferred apply outlasted the confirm loop and the stored status went
// stale (there is no notify event or poll cadence for the system clock).
export async function refreshSysClock(s: ReadySession): Promise<void> {
  try {
    const status = await s.queue.run(() => s.device.getSysClock());
    if (s.alive) s.sysClock.status = status;
  } catch (e) {
    pushNotice('error', `System clock read failed: ${errMessage(e)}`);
  }
}

// M6 — DAC HW mute test pulse (~1s). Fire-and-forget.
export function testDacHwMute(s: ReadySession): void {
  void command(s, 'DAC mute test', () => s.device.testDacHwMute(), () => {});
}

// M9 — Buffer stats reset.
export function resetBufferStats(s: ReadySession): void {
  void command(s, 'reset buffer stats', () => s.device.resetBufferStats(), () => {});
}

// M8 — Enter UF2 bootloader. The device disconnects immediately (100 ms delay
// in firmware before reset_usb_boot). The transfer may throw as the device
// drops mid-response; that is expected and is treated as a normal disconnect.
export async function enterBootloader(s: ReadySession): Promise<void> {
  try {
    await s.queue.run(() => s.device.enterBootloader());
  } catch {
    // Device dropped during or after the command -- that's the expected path.
  }
  // The transport disconnect event fires naturally after the device reboots
  // and triggers normal disconnect flow via attachTransportListeners.
}

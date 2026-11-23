import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootMock } from './boot';
import { startPolling } from './poll';
import * as State from '@/state';
import * as Domain from '@/domain';
import { DspDevice } from '@/device/DspDevice';
import { MockTransport } from '@/transport/MockTransport';
import { UntranslatedCommand } from '@/protocol/legacyTranslate';
import { GenerationRefusal } from '@/transport/withGenerationGuard';
import { resolveMockProfile } from '@/mockProfiles';
import { wantCsExtPoll, wantCsDisplayPoll } from './controlSurfaceActions';
import type { LoopClock } from '@/utils';

function manualClock(): LoopClock & { fire(): void } {
  let cb: (() => void) | null = null;
  return {
    next(c) { cb = c; },
    cancel() { cb = null; },
    fire() { const c = cb; cb = null; c?.(); },
  };
}

// Every DspDevice method records a rejection that means the console asked a
// paged device for something it cannot translate or the guard refuses.
function watchDevice(): { failures: string[]; called: Set<string> } {
  const failures: string[] = [];
  const called = new Set<string>();
  for (const name of Object.getOwnPropertyNames(DspDevice.prototype)) {
    const desc = Object.getOwnPropertyDescriptor(DspDevice.prototype, name);
    if (name === 'constructor' || typeof desc?.value !== 'function') continue;
    const real = desc.value as (...a: unknown[]) => unknown;
    vi.spyOn(DspDevice.prototype as unknown as Record<string, (...a: unknown[]) => unknown>, name).mockImplementation(function (this: DspDevice, ...args: unknown[]) {
      called.add(name);
      const out = real.apply(this, args);
      if (out instanceof Promise) {
        return out.catch((err: unknown) => {
          if (err instanceof UntranslatedCommand || err instanceof GenerationRefusal) failures.push(`${name}: ${err.message}`);
          throw err;
        });
      }
      return out;
    });
  }
  return { failures, called };
}

beforeEach(() => { State.resetAppState(); State.clearNotices(); });
afterEach(() => { State.activeSession()?.dispose(); State.resetAppState(); vi.restoreAllMocks(); });

describe.each<'rp2350' | 'rp2040'>(['rp2350', 'rp2040'])('paged session on %s', (chip) => {
  it('runs its connect fetches and enabled polls without an untranslatable request or a write', async () => {
    const outs: number[] = [];
    vi.spyOn(MockTransport.prototype, 'ctrlOut').mockImplementation(async (cmd) => { outs.push(cmd); });
    const { failures, called } = watchDevice();

    const profile = resolveMockProfile('v34', chip);
    await bootMock(profile.platform, profile.opts);
    const s = State.activeSession()!;
    // Connect fetched what it can translate.
    expect(s.presets.directory).not.toBeNull();
    expect(s.presets.lastFetchError).toBeNull();
    expect(s.ctrlIfaces.uart).not.toBeNull();
    expect(s.controlSurfaces.caps).not.toBeNull();
    expect(s.controlSurfaces.lastFetchError).toBeNull();
    expect(s.outputLatency.supported).toBe(true);
    expect(s.names.deviceSupported).toBe(true);
    expect(s.sysClock.supported).toBe(false);

    // Open every re-enabled cadence's gate.
    const snap = s.mirror.current!;
    snap.inputConfig.source = Domain.AudioInputSource.Spdif;
    snap.inputConfig.i2sClockMode = 1;
    snap.inputConfig.adatInputEnabled = true;
    snap.adat.enabled = true;
    snap.subharm.enabled = true;
    // An active display binding and a held interest open the display poll.
    s.controlSurfaces.bindings = [{ type: Domain.CsType.Display } as Domain.CsBinding];
    s.controlSurfaces.status = { ...s.controlSurfaces.status, activeMask: 1 } as Domain.CsStatus;
    const releases = [
      s.telemetry.wantBufferStats(), s.telemetry.wantSubharmMeter(), s.telemetry.wantLimiterMeter(),
      wantCsExtPoll(s), wantCsDisplayPoll(s),
    ];
    const clock = manualClock();
    const stop = startPolling(s, clock);
    for (let i = 0; i < 3; i++) {
      clock.fire();
      await vi.waitFor(() => expect(called.has('getLimiterMeter')).toBe(true));
      await new Promise((r) => setTimeout(r, 5));
    }
    stop();
    releases.forEach((r) => r());

    const adat = chip === 'rp2350' ? ['getAdatStatus', 'getAdatInputStatus'] : [];
    for (const name of ['getBufferStats', 'getSpdifRxStatus', 'getI2sSlaveStatus', 'getSubharmHeadroom', 'getSubharmMeter', 'getLimiterMeter', 'getLimiterStatus', 'getCsExtStatus', 'getCsDisplayStatus', ...adat]) {
      expect(called.has(name), name).toBe(true);
    }
    expect(failures).toEqual([]);
    expect(outs).toEqual([]);
  });
});

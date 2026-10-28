import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootMock } from './boot';
import { activeSession, clearNotices, resetAppState } from '@/state';
import { AudioInputSource, SysClockMode, SYS_CLOCK_VREG_DEFAULT, type SysClockStatus } from '@/domain';
import { Wire } from '@/protocol';
import * as Staged from './stagedActions';
import * as SystemActions from './systemActions';

const { PIN_RESET_TO_DEFAULT } = Wire.Const;

const sess = () => activeSession()!;

afterEach(() => { activeSession()?.dispose(); resetAppState(); });

describe('runtime/stagedActions', () => {
  describe('stageInputSource', () => {
    beforeEach(async () => {
      await bootMock('rp2350');
      clearNotices();
    });

    it('stages a pending entry; applying it calls device.setInputSource with the staged value', async () => {
      const s = sess();
      const live = s.mirror.snapshot.inputConfig.source;
      const target = live === AudioInputSource.Spdif ? AudioInputSource.Usb : AudioInputSource.Spdif;
      const spy = vi.spyOn(s.device, 'setInputSource');

      Staged.stageInputSource(s, target);
      expect(s.staging.has('inputSource')).toBe(true);
      expect(spy).not.toHaveBeenCalled();

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(target);
      expect(s.staging.has('inputSource')).toBe(false);
      expect(s.mirror.snapshot.inputConfig.source).toBe(target);
    });

    it('staging the live value discards a pending entry instead of creating one', () => {
      const s = sess();
      const live = s.mirror.snapshot.inputConfig.source;
      const other = live === AudioInputSource.Spdif ? AudioInputSource.Usb : AudioInputSource.Spdif;

      Staged.stageInputSource(s, other);
      expect(s.staging.has('inputSource')).toBe(true);
      Staged.stageInputSource(s, live);
      expect(s.staging.has('inputSource')).toBe(false);
    });

    // Firmware regenerates default input-channel names on a source switch but
    // tags the notify Host-sourced, which the notify channel drops as a
    // self-echo -- applying the stage must force a reconcile itself so the
    // mirror picks up the regenerated names from a fresh bulk read.
    it('requests an eager reconcile once the apply succeeds', async () => {
      const s = sess();
      const live = s.mirror.snapshot.inputConfig.source;
      const target = live === AudioInputSource.Spdif ? AudioInputSource.Usb : AudioInputSource.Spdif;

      Staged.stageInputSource(s, target);
      expect(s.mirror.peekReconcile()).toEqual({ wanted: false, eager: false });

      await s.staging.applyAll();
      expect(s.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    });
  });

  describe('stageI2sRxPin', () => {
    beforeEach(async () => {
      await bootMock('rp2350');
      clearNotices();
    });

    it('stages a per-pair pending entry; applying it calls device.setI2sRxPin(pair, gpio)', async () => {
      const s = sess();
      const target = 21; // unused GPIO on the default RP2350 mock layout
      const spy = vi.spyOn(s.device, 'setI2sRxPin');

      Staged.stageI2sRxPin(s, 0, target);
      expect(s.staging.has('i2sRxPin:0')).toBe(true);

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(0, target);
      expect(s.staging.has('i2sRxPin:0')).toBe(false);
      expect(s.mirror.snapshot.inputConfig.i2sRxPins[0]).toBe(target);
    });

    it('staging the live pin discards the pending entry', () => {
      const s = sess();
      const live = s.mirror.snapshot.inputConfig.i2sRxPins[0] ?? 0;
      Staged.stageI2sRxPin(s, 0, live);
      expect(s.staging.has('i2sRxPin:0')).toBe(false);
    });

    it('staging a channel count that drops a pair discards its orphaned rx-pin entry, keeping the rest', () => {
      const s = sess();
      Staged.stageI2sRxPin(s, 0, 21);
      Staged.stageI2sRxPin(s, 1, 22);
      Staged.stageI2sRxPin(s, 3, 23);
      expect(s.staging.has('i2sRxPin:3')).toBe(true);

      Staged.stageI2sInputChannels(s, 4);

      expect(s.staging.has('i2sRxPin:3')).toBe(false);
      expect(s.staging.has('i2sRxPin:0')).toBe(true);
      expect(s.staging.has('i2sRxPin:1')).toBe(true);
    });
  });

  describe('stageI2sClockMode', () => {
    beforeEach(async () => {
      await bootMock('rp2350');
      clearNotices();
    });

    it('stages a pending role switch; applying it calls device.setI2sClockMode with the staged value', async () => {
      const s = sess();
      const live = s.mirror.snapshot.inputConfig.i2sClockMode;
      const target = live === 1 ? 0 : 1;
      const spy = vi.spyOn(s.device, 'setI2sClockMode');

      Staged.stageI2sClockMode(s, target);
      expect(s.staging.has('i2sClockMode')).toBe(true);
      expect(spy).not.toHaveBeenCalled();

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(target);
      expect(s.staging.has('i2sClockMode')).toBe(false);
      expect(s.mirror.snapshot.inputConfig.i2sClockMode).toBe(target);
    });

    it('staging the live value discards a pending entry instead of creating one', () => {
      const s = sess();
      const live = s.mirror.snapshot.inputConfig.i2sClockMode;
      Staged.stageI2sClockMode(s, live === 1 ? 0 : 1);
      expect(s.staging.has('i2sClockMode')).toBe(true);
      Staged.stageI2sClockMode(s, live);
      expect(s.staging.has('i2sClockMode')).toBe(false);
    });
  });

  describe('stageI2sClockPinMode', () => {
    beforeEach(async () => {
      await bootMock('rp2350');
      clearNotices();
    });

    it('stages a pending pin-mode switch; applying it calls device.setI2sClockPinMode', async () => {
      const s = sess();
      const live = s.mirror.snapshot.i2s.clockPinMode;
      const target = live === 1 ? 0 : 1;
      const spy = vi.spyOn(s.device, 'setI2sClockPinMode');

      Staged.stageI2sClockPinMode(s, target);
      expect(s.staging.has('i2sClockPinMode')).toBe(true);

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(target);
      expect(s.staging.has('i2sClockPinMode')).toBe(false);
      expect(s.mirror.snapshot.i2s.clockPinMode).toBe(target);
    });
  });

  describe('stageI2sBckPinSlave', () => {
    beforeEach(async () => {
      await bootMock('rp2350');
      clearNotices();
    });

    it('stages a pending slave BCK pin; applying it calls device.setI2sBckPin(pin, 1)', async () => {
      const s = sess();
      const target = 21;   // distinct from the mock's default slave BCK pin (26 on rp2350)
      const spy = vi.spyOn(s.device, 'setI2sBckPin');

      Staged.stageI2sBckPinSlave(s, target);
      expect(s.staging.has('bckPinSlave')).toBe(true);

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(target, 1);
      expect(s.staging.has('bckPinSlave')).toBe(false);
      expect(s.mirror.snapshot.i2s.bckPinSlave).toBe(target);
    });

    it('staging the live pin discards the pending entry', () => {
      const s = sess();
      const live = s.mirror.snapshot.i2s.bckPinSlave;
      Staged.stageI2sBckPinSlave(s, live);
      expect(s.staging.has('bckPinSlave')).toBe(false);
    });
  });

  describe('stageMckEnabled', () => {
    beforeEach(async () => {
      await bootMock('rp2350');
      clearNotices();
    });

    it('stages a pending toggle; applying it calls device.setMckEnable with the staged value', async () => {
      const s = sess();
      const live = s.mirror.snapshot.i2s.mckEnabled;
      const spy = vi.spyOn(s.device, 'setMckEnable');

      Staged.stageMckEnabled(s, !live);
      expect(s.staging.has('mckEnabled')).toBe(true);

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(!live);
      expect(s.staging.has('mckEnabled')).toBe(false);
      expect(s.mirror.snapshot.i2s.mckEnabled).toBe(!live);
    });

    it('staging the live value discards the pending entry', () => {
      const s = sess();
      const live = s.mirror.snapshot.i2s.mckEnabled;
      Staged.stageMckEnabled(s, !live);
      Staged.stageMckEnabled(s, live);
      expect(s.staging.has('mckEnabled')).toBe(false);
    });
  });

  // Universal pin-reset escape hatch (fw 0xFF sentinel): staging DEFAULT
  // on any pin picker. stageOutputDataPin stands in for the whole family --
  // every stage*Pin function routes the sentinel through the same fmtPinTo /
  // overlayPin / applyPin helpers.
  describe('pin-reset-to-default (0xFF sentinel)', () => {
    beforeEach(async () => {
      await bootMock('rp2350');
      clearNotices();
    });

    it('labels the staged change "default" instead of "GP255"', () => {
      const s = sess();
      Staged.stageOutputDataPin(s, 0, PIN_RESET_TO_DEFAULT);
      const entry = s.staging.get('outputPin:0')!;
      expect(entry.to).toBe('default');
      expect(entry.from).toBe(`GP${s.mirror.snapshot.outputPins[0]}`);
    });

    it('applying sends the raw 0xFF sentinel to the device', async () => {
      const s = sess();
      const spy = vi.spyOn(s.device, 'setOutputPin');
      Staged.stageOutputDataPin(s, 0, PIN_RESET_TO_DEFAULT);
      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(0, PIN_RESET_TO_DEFAULT);
    });

    it('overlay keeps the live pin instead of writing 0xFF into it', () => {
      const s = sess();
      const live = s.mirror.snapshot.outputPins[0];
      Staged.stageOutputDataPin(s, 0, PIN_RESET_TO_DEFAULT);
      const overlay = s.staging.overlaySnapshot(s.mirror.snapshot);
      expect(overlay.outputPins[0]).toBe(live);
      expect(overlay.outputPins).not.toContain(PIN_RESET_TO_DEFAULT);
    });

    it('requests an eager reconcile once the reset apply succeeds, unlike a plain pin move', async () => {
      const s = sess();
      Staged.stageMckPin(s, 20);   // plain move: an ordinary pin, not the sentinel
      await s.staging.applyAll();
      expect(s.mirror.peekReconcile()).toEqual({ wanted: true, eager: false });

      Staged.stageOutputDataPin(s, 0, PIN_RESET_TO_DEFAULT);
      await s.staging.applyAll();
      expect(s.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    });
  });

  describe('hardware enables and relocations', () => {
    beforeEach(async () => {
      await bootMock('rp2350');
      clearNotices();
    });

    it('enabling ADAT on a taken pin stages a visible pin entry that applies before the enable', async () => {
      const s = sess();
      s.mirror.snapshot.dacHwMute = { enabled: true, activeLow: false, pin: 12, holdMs: 10, releaseMs: 0 };
      s.mirror.snapshot.adat = { ...s.mirror.snapshot.adat, enabled: false, pin: 0 };
      const pinSpy = vi.spyOn(s.device, 'setAdatPin').mockResolvedValue({ ok: true, value: undefined });
      const enableSpy = vi.spyOn(s.device, 'setAdatEnable').mockResolvedValue({ ok: true, value: undefined });

      Staged.stageAdatEnabled(s, true);
      const pinEntry = s.staging.get('adatPin');
      expect(pinEntry?.from).toBe('GP12');
      expect(pinEntry?.to).not.toBe('GP12');
      expect(s.staging.has('adatEnable')).toBe(true);
      expect(pinSpy).not.toHaveBeenCalled();

      await s.staging.applyAll();
      expect(enableSpy).toHaveBeenCalledWith(true);
      expect(pinSpy.mock.invocationCallOrder[0]).toBeLessThan(enableSpy.mock.invocationCallOrder[0]);
      expect(s.staging.entries).toHaveLength(0);
    });

    it('DAC mute edits stage separately but apply as one merged device write', async () => {
      const s = sess();
      s.mirror.snapshot.dacHwMute = { enabled: false, activeLow: false, pin: 11, holdMs: 10, releaseMs: 0 };
      const spy = vi.spyOn(s.device, 'setDacHwMute');

      Staged.stageDacMuteEnabled(s, true);
      Staged.stageDacMute(s, 'activeLow', true);
      expect(s.staging.entries.map((e) => e.key).sort()).toEqual(['dacMute:activeLow', 'dacMute:enabled']);

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({ enabled: true, activeLow: true, pin: 11 });
    });

    it('a UART disable applies before a DAC mute claims its pin', async () => {
      const s = sess();
      s.ctrlIfaces.uart = { enabled: true, txPin: 16, rxPin: 17, notifyEnabled: false, baud: 115200 };
      s.mirror.snapshot.dacHwMute = { enabled: false, activeLow: false, pin: 11, holdMs: 10, releaseMs: 0 };
      const uartSpy = vi.spyOn(s.device, 'setUartControlConfig');
      const muteSpy = vi.spyOn(s.device, 'setDacHwMute');

      Staged.stageUartEnabled(s, false);
      Staged.stageDacMute(s, 'pin', 16);
      Staged.stageDacMuteEnabled(s, true);
      expect(s.staging.get('dacMute:pin')?.to).toBe('GP16');

      await s.staging.applyAll();
      expect(uartSpy).toHaveBeenCalledTimes(1);
      expect(muteSpy).toHaveBeenCalledTimes(1);
      expect(uartSpy.mock.invocationCallOrder[0]).toBeLessThan(muteSpy.mock.invocationCallOrder[0]);
    });

    it('a DAC mute disable applies before ADAT output claims its pin', async () => {
      const s = sess();
      s.mirror.snapshot.dacHwMute = { enabled: true, activeLow: false, pin: 21, holdMs: 10, releaseMs: 0 };
      s.mirror.snapshot.adat = { ...s.mirror.snapshot.adat, enabled: false, pin: 21 };
      const muteSpy = vi.spyOn(s.device, 'setDacHwMute');
      const adatSpy = vi.spyOn(s.device, 'setAdatEnable').mockResolvedValue({ ok: true, value: undefined });

      Staged.stageDacMuteEnabled(s, false);
      Staged.stageAdatEnabled(s, true);
      expect(s.staging.has('adatPin')).toBe(false);

      await s.staging.applyAll();
      expect(muteSpy.mock.invocationCallOrder[0]).toBeLessThan(adatSpy.mock.invocationCallOrder[0]);
    });

    it('an ADAT input disable applies before its pin is cleared', async () => {
      const s = sess();
      s.mirror.snapshot.inputConfig = { ...s.mirror.snapshot.inputConfig, adatInputEnabled: true, adatInputPin: 20 };
      const enableSpy = vi.spyOn(s.device, 'setAdatInputEnable').mockResolvedValue({ ok: true, value: undefined });
      const pinSpy = vi.spyOn(s.device, 'setAdatInputPin').mockResolvedValue({ ok: true, value: undefined });

      Staged.stageAdatInputPin(s, 0);
      Staged.stageAdatInputEnabled(s, false);

      await s.staging.applyAll();
      expect(enableSpy.mock.invocationCallOrder[0]).toBeLessThan(pinSpy.mock.invocationCallOrder[0]);
    });

    it('discarding a parent drops the pin or voltage entries it staged on its own', () => {
      const s = sess();
      s.mirror.snapshot.dacHwMute = { enabled: true, activeLow: false, pin: 12, holdMs: 10, releaseMs: 0 };
      s.mirror.snapshot.adat = { ...s.mirror.snapshot.adat, enabled: false, pin: 0 };
      Staged.stageAdatEnabled(s, true);
      expect(s.staging.has('adatPin')).toBe(true);

      Staged.stageAdatEnabled(s, false);
      expect(s.staging.entries).toHaveLength(0);

      Staged.stageAdatEnabled(s, true);
      s.staging.discard('adatEnable');
      expect(s.staging.entries).toHaveLength(0);
    });

    it('pair and PDM enables overlay the snapshot at stage time and disables apply before enables', async () => {
      const s = sess();
      const pdm = s.mirror.snapshot.platform.pdmOutputIndex;
      const spy = vi.spyOn(s.device, 'setOutputEnable');
      s.mirror.snapshot.outputs = s.mirror.snapshot.outputs.map((o) => ({ ...o, enabled: o.wireIndex === 2 || o.wireIndex === 3 }));

      Staged.stagePdmEnabled(s, true);
      Staged.stageOutputPairEnabled(s, 1, false);
      const overlay = s.staging.overlaySnapshot(s.mirror.snapshot);
      expect(overlay.outputs.find((o) => o.wireIndex === pdm)?.enabled).toBe(true);
      expect(overlay.outputs.find((o) => o.wireIndex === 2)?.enabled).toBe(false);

      await s.staging.applyAll();
      const calls = spy.mock.calls.map((c) => [c[0], c[1]]);
      expect(calls.findIndex((c) => c[0] === 2 && c[1] === false)).toBeLessThan(calls.findIndex((c) => c[0] === pdm && c[1] === true));
    });

    it('UART fields stage individually and apply as one config write', async () => {
      const s = sess();
      s.ctrlIfaces.uart = { enabled: false, txPin: 16, rxPin: 17, notifyEnabled: false, baud: 115200 };
      const live = s.ctrlIfaces.uart;
      const spy = vi.spyOn(s.device, 'setUartControlConfig');

      Staged.stageUartEnabled(s, !live.enabled);
      Staged.stageUart(s, 'baud', live.baud === 115200 ? 57600 : 115200);
      expect(s.staging.entries.every((e) => e.page === 'interfaces')).toBe(true);

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(s.staging.entries).toHaveLength(0);
    });
  });

  describe('system clock', () => {
    const sysClockStatus = (over: Partial<SysClockStatus>): SysClockStatus => ({
      activeMode: SysClockMode.Mhz307p2, storedMode: SysClockMode.Mhz307p2, storedVregSel: SYS_CLOCK_VREG_DEFAULT,
      liveVreg: 12, fallbackActive: false, ...over,
    });

    beforeEach(async () => {
      await bootMock('rp2350');
      clearNotices();
    });

    it('a mode change under an explicit lower voltage stages a visible DEFAULT reset and applies once, flagged disruptive', async () => {
      const s = sess();
      s.sysClock.status = sysClockStatus({ storedMode: SysClockMode.Mhz307p2, storedVregSel: 12 });
      const apply = vi.spyOn(SystemActions, 'applySysClock').mockImplementation(async (sess, mode, vregSel) => {
        sess.sysClock.status = sysClockStatus({ storedMode: mode, storedVregSel: vregSel });
        return true;
      });

      Staged.stageSysClockMode(s, SysClockMode.Mhz384);
      expect(s.staging.get('sysClock:vreg')?.to).toBe('default');
      expect(s.staging.disruptive).toEqual({ reason: 'reboots the clock', tone: 'danger' });

      await s.staging.applyAll();
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply.mock.calls[0].slice(1)).toEqual([SysClockMode.Mhz384, SYS_CLOCK_VREG_DEFAULT]);
    });

    it('the DEFAULT voltage reset goes away with the mode change that caused it', () => {
      const s = sess();
      s.sysClock.status = sysClockStatus({ storedMode: SysClockMode.Mhz307p2, storedVregSel: 12 });
      Staged.stageSysClockMode(s, SysClockMode.Mhz384);
      expect(s.staging.has('sysClock:vreg')).toBe(true);
      Staged.stageSysClockMode(s, SysClockMode.Mhz307p2);
      expect(s.staging.entries).toHaveLength(0);
    });

    it('staging back to the stored value discards the entry', () => {
      const s = sess();
      s.sysClock.status = sysClockStatus({ storedVregSel: SYS_CLOCK_VREG_DEFAULT });
      Staged.stageSysClockVreg(s, 14);
      expect(s.staging.has('sysClock:vreg')).toBe(true);
      Staged.stageSysClockVreg(s, SYS_CLOCK_VREG_DEFAULT);
      expect(s.staging.has('sysClock:vreg')).toBe(false);
    });
  });
});

describe('runtime/stagedActions: output latency', () => {
  beforeEach(async () => {
    await bootMock('rp2350', { wireVersion: Wire.MAX_WIRE_VERSION, fwHead: true });
    clearNotices();
  });

  it('applying the staged option sets it and waits out the deferred restart', async () => {
    const s = sess();
    const live = s.outputLatency.status!.requestedId;
    const target = live === 7 ? 6 : 7;
    const set = vi.spyOn(s.device, 'setOutputLatency');

    Staged.stageOutputLatency(s, target);
    const entry = s.staging.get('outputLatency')!;
    expect(entry.page).toBe('outputs');
    expect(entry.disruptive).toBeTruthy();
    expect(set).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      const applied = s.staging.applyAll();
      await vi.runAllTimersAsync();
      await applied;
    } finally {
      vi.useRealTimers();
    }
    expect(set).toHaveBeenCalledWith(target);
    expect(s.outputLatency.status?.requestedId).toBe(target);
    expect(s.outputLatency.status?.pending).toBe(false);
    expect(s.staging.has('outputLatency')).toBe(false);
  });

  it('staging the live option discards the pending entry', () => {
    const s = sess();
    const live = s.outputLatency.status!.requestedId;
    Staged.stageOutputLatency(s, live === 7 ? 6 : 7);
    Staged.stageOutputLatency(s, live);
    expect(s.staging.has('outputLatency')).toBe(false);
  });
});

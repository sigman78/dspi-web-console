import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bootMock } from './boot';
import { activeSession, clearNotices } from '@/state';
import { AudioInputSource } from '@/domain';
import {
  stageInputSource, stageI2sRxPin, stageI2sInputChannels, stageMckEnabled,
  stageI2sClockMode, stageI2sClockPinMode, stageI2sBckPinSlave,
} from './stagedActions';

const sess = () => activeSession()!;

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

      stageInputSource(s, target);
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

      stageInputSource(s, other);
      expect(s.staging.has('inputSource')).toBe(true);
      stageInputSource(s, live);
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

      stageInputSource(s, target);
      expect(s.mirror.peekReconcile()).toEqual({ wanted: false, eager: false });

      await s.staging.applyAll();
      expect(s.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    });
  });

  describe('stageI2sRxPin', () => {
    beforeEach(async () => {
      await bootMock('rp2350', { wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 } });
      clearNotices();
    });

    it('stages a per-pair pending entry; applying it calls device.setI2sRxPin(pair, gpio)', async () => {
      const s = sess();
      const target = 21; // unused GPIO on the default RP2350 V16 mock layout
      const spy = vi.spyOn(s.device, 'setI2sRxPin');

      stageI2sRxPin(s, 0, target);
      expect(s.staging.has('i2sRxPin:0')).toBe(true);

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(0, target);
      expect(s.staging.has('i2sRxPin:0')).toBe(false);
      expect(s.mirror.snapshot.inputConfig.i2sRxPins[0]).toBe(target);
    });

    it('staging the live pin discards the pending entry', () => {
      const s = sess();
      const live = s.mirror.snapshot.inputConfig.i2sRxPins[0] ?? 0;
      stageI2sRxPin(s, 0, live);
      expect(s.staging.has('i2sRxPin:0')).toBe(false);
    });

    it('staging a channel count that drops a pair discards its orphaned rx-pin entry, keeping the rest', () => {
      const s = sess();
      stageI2sRxPin(s, 0, 21);
      stageI2sRxPin(s, 1, 22);
      stageI2sRxPin(s, 3, 23);
      expect(s.staging.has('i2sRxPin:3')).toBe(true);

      stageI2sInputChannels(s, 4);

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

      stageI2sClockMode(s, target);
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
      stageI2sClockMode(s, live === 1 ? 0 : 1);
      expect(s.staging.has('i2sClockMode')).toBe(true);
      stageI2sClockMode(s, live);
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

      stageI2sClockPinMode(s, target);
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

      stageI2sBckPinSlave(s, target);
      expect(s.staging.has('bckPinSlave')).toBe(true);

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(target, 1);
      expect(s.staging.has('bckPinSlave')).toBe(false);
      expect(s.mirror.snapshot.i2s.bckPinSlave).toBe(target);
    });

    it('staging the live pin discards the pending entry', () => {
      const s = sess();
      const live = s.mirror.snapshot.i2s.bckPinSlave;
      stageI2sBckPinSlave(s, live);
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

      stageMckEnabled(s, !live);
      expect(s.staging.has('mckEnabled')).toBe(true);

      await s.staging.applyAll();
      expect(spy).toHaveBeenCalledWith(!live);
      expect(s.staging.has('mckEnabled')).toBe(false);
      expect(s.mirror.snapshot.i2s.mckEnabled).toBe(!live);
    });

    it('staging the live value discards the pending entry', () => {
      const s = sess();
      const live = s.mirror.snapshot.i2s.mckEnabled;
      stageMckEnabled(s, !live);
      stageMckEnabled(s, live);
      expect(s.staging.has('mckEnabled')).toBe(false);
    });
  });
});

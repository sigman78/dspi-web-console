import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootMock } from './boot';
import { activeSession, clearNotices, resetAppState } from '@/state';
import { AudioInputSource, SysClockMode, SYS_CLOCK_VREG_DEFAULT, type SysClockStatus } from '@/domain';
import { Wire } from '@/protocol';
import { resolveMockProfile } from '@/mockProfiles';
import * as Staged from './stagedActions';
import * as IoActions from './ioActions';
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

  describe('input blocks', () => {
    async function bootPaged() {
      const profile = resolveMockProfile('v34', 'rp2350');
      await bootMock(profile.platform, profile.opts);
      clearNotices();
      return sess();
    }

    async function bootWith(cfg: { spdifEnabled: boolean; spdifCount: number }) {
      const s = await bootPaged();
      Object.assign(s.mirror.snapshot.inputConfig, cfg);
      return s;
    }

    const keys = (s: ReturnType<typeof sess>) => s.staging.entries.map((e) => e.key).sort();

    describe('picking a source', () => {
      it('I2S with its block off stages the block ahead of the source, and both stay when the pick moves on', async () => {
        const s = await bootPaged();
        expect(s.mirror.snapshot.inputConfig.i2sEnabled).toBe(false);

        Staged.stageInputSource(s, AudioInputSource.I2s);
        expect(s.staging.get('i2sBlock')!.order).toBeLessThan(s.staging.get('inputSource')!.order);

        Staged.stageInputSource(s, AudioInputSource.Usb);
        expect(keys(s)).toEqual(['i2sBlock']);
      });

      it('applying the staged block and source switches to I2S', async () => {
        const s = await bootPaged();
        Staged.stageInputSource(s, AudioInputSource.I2s);
        await s.staging.applyAll();
        expect(s.mirror.snapshot.inputConfig.source).toBe(AudioInputSource.I2s);
        expect(s.mirror.snapshot.inputConfig.i2sEnabled).toBe(true);
      });

      it('ADAT stages its input enable on either firmware generation, and ✕ on the enable drops the source', async () => {
        const s = await bootPaged();
        Staged.stageInputSource(s, AudioInputSource.Adat);
        expect(s.staging.has('adatInputEnable')).toBe(true);
        Staged.discardStagedEntry(s, 'adatInputEnable');
        expect(s.staging.has('inputSource')).toBe(false);

        s.dispose();
        resetAppState();
        await bootMock('rp2350');
        Staged.stageInputSource(sess(), AudioInputSource.Adat);
        expect(sess().staging.has('adatInputEnable')).toBe(true);
      });

      it('stages nothing extra on a 1.1.6 device for I2S', async () => {
        await bootMock('rp2350');
        const s = sess();
        Staged.stageInputSource(s, AudioInputSource.I2s);
        expect(keys(s)).toEqual(['inputSource']);
      });

      it('on 1.1.6, S/PDIF 3 raises the count and applies it before the source switch', async () => {
        await bootMock('rp2350');
        const s = sess();
        expect(s.device.capabilities.features.inputBlocks).toBe(false);
        expect(s.mirror.snapshot.inputConfig).toMatchObject({ spdifEnabled: true, i2sEnabled: true, spdifCount: 1 });
        const count = vi.spyOn(s.device, 'setSpdifInputCount');
        const src = vi.spyOn(s.device, 'setInputSource');

        Staged.stageInputSource(s, AudioInputSource.Spdif3);
        expect(keys(s)).toEqual(['inputSource', 'spdifCount']);
        expect(s.staging.get('spdifCount')?.value).toBe(3);

        await s.staging.applyAll();
        expect(count).toHaveBeenCalledWith(3);
        expect(src).toHaveBeenCalledWith(AudioInputSource.Spdif3);
        expect(count.mock.invocationCallOrder[0]).toBeLessThan(src.mock.invocationCallOrder[0]);
      });

      it('an input the remembered count already covers stages the block alone', async () => {
        const s = await bootWith({ spdifEnabled: false, spdifCount: 4 });
        Staged.stageInputSource(s, AudioInputSource.Spdif2);
        expect(keys(s)).toEqual(['inputSource', 'spdifBlock']);
      });

      it('an input beyond the count raises it to exactly the input', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 1 });
        Staged.stageInputSource(s, AudioInputSource.Spdif3);
        expect(s.staging.get('spdifCount')?.value).toBe(3);
      });

      it('re-clicking the selected radio changes nothing and keeps a staged pin, even from block off', async () => {
        const s = await bootWith({ spdifEnabled: false, spdifCount: 1 });
        Staged.stageInputSource(s, AudioInputSource.Spdif);
        Staged.stageSpdifRxPin(s, 25);
        const before = keys(s);
        Staged.stageInputSource(s, AudioInputSource.Spdif);
        expect(keys(s)).toEqual(before);
        expect(s.staging.has('spdifRxPin')).toBe(true);
      });

      it('moving between S/PDIF sources keeps the pins of inputs that stay on', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 1 });
        Staged.stageInputSource(s, AudioInputSource.Spdif3);
        Staged.stageSpdifRxPinExt(s, 0, 23);
        Staged.stageSpdifRxPinExt(s, 1, 26);
        Staged.stageInputSource(s, AudioInputSource.Spdif4);
        expect(s.staging.has('spdifRxPinExt:0')).toBe(true);
        expect(s.staging.has('spdifRxPinExt:1')).toBe(true);
        expect(s.staging.get('spdifCount')?.value).toBe(4);
      });

      it('a manual raise survives a later pick', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 1 });
        Staged.stageSpdifInputOn(s, 3, true);
        Staged.stageInputSource(s, AudioInputSource.Spdif2);
        Staged.stageInputSource(s, AudioInputSource.Usb);
        expect(s.staging.get('spdifCount')?.value).toBe(4);
      });
    });

    describe('discarding what a source needs', () => {
      it('✕ on the count drops the source that needed it, with the pins it brought', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 1 });
        Staged.stageInputSource(s, AudioInputSource.Spdif3);
        Staged.stageSpdifRxPinExt(s, 1, 26);
        Staged.discardStagedEntry(s, 'spdifCount');
        expect(s.staging.entries).toEqual([]);
      });

      it('✕ on the block drops the source that needed it', async () => {
        const s = await bootWith({ spdifEnabled: false, spdifCount: 2 });
        Staged.stageInputSource(s, AudioInputSource.Spdif);
        Staged.discardStagedEntry(s, 'spdifBlock');
        expect(s.staging.entries).toEqual([]);
      });

      it('a block that ends up off drops a staged count, including via ✕ on a staged block-on', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 1 });
        Staged.stageSpdifInputCount(s, 3);
        Staged.stageSpdifInputOn(s, 0, false);
        expect(s.staging.has('spdifCount')).toBe(false);
        expect(s.staging.get('spdifBlock')?.value).toBe(false);

        s.staging.discardAll();
        Object.assign(s.mirror.snapshot.inputConfig, { spdifEnabled: false, spdifCount: 1 });
        Staged.stageSpdifInputOn(s, 2, true);
        expect(keys(s)).toEqual(['spdifBlock', 'spdifCount']);
        Staged.discardStagedEntry(s, 'spdifBlock');
        expect(s.staging.entries).toEqual([]);
      });

      it('shrinking the count drops staged pins of the inputs that go', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 4 });
        Staged.stageSpdifRxPinExt(s, 0, 23);
        Staged.stageSpdifRxPinExt(s, 2, 26);
        Staged.stageSpdifInputCount(s, 2);
        expect(s.staging.has('spdifRxPinExt:0')).toBe(true);
        expect(s.staging.has('spdifRxPinExt:2')).toBe(false);
      });

      it('switching the S/PDIF block off drops every staged S/PDIF pin', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 3 });
        Staged.stageSpdifRxPin(s, 25);
        Staged.stageSpdifRxPinExt(s, 0, 23);
        Staged.stageSpdifInputOn(s, 0, false);
        expect(s.staging.has('spdifRxPin')).toBe(false);
        expect(s.staging.has('spdifRxPinExt:0')).toBe(false);
      });

      it('I2S pins go with a shrunk channel count and with the block', async () => {
        const s = await bootPaged();
        Object.assign(s.mirror.snapshot.inputConfig, { i2sEnabled: true, i2sInputChannels: 2 });
        s.mirror.snapshot.inputConfig.i2sRxPins = [15, 16, 17, 18];
        Staged.stageI2sInputChannels(s, 4);
        Staged.stageI2sRxPin(s, 1, 21);
        Staged.stageI2sInputChannels(s, 2);
        expect(s.staging.has('i2sRxPin:1')).toBe(false);

        Staged.stageI2sRxPin(s, 0, 22);
        Staged.stageI2sInputEnabled(s, false);
        expect(s.staging.has('i2sRxPin:0')).toBe(false);
      });

      it('a staged I2S channel count goes when I2S ends up off, including via ✕ on a staged block-on', async () => {
        const s = await bootPaged();
        Object.assign(s.mirror.snapshot.inputConfig, { i2sEnabled: true, i2sInputChannels: 2 });
        Staged.stageI2sInputChannels(s, 4);
        Staged.stageI2sInputEnabled(s, false);
        expect(s.staging.has('i2sChannels')).toBe(false);

        s.staging.discardAll();
        s.mirror.snapshot.inputConfig.i2sEnabled = false;
        Staged.stageI2sInputEnabled(s, true);
        Staged.stageI2sInputChannels(s, 4);
        Staged.discardStagedEntry(s, 'i2sBlock');
        expect(s.staging.has('i2sChannels')).toBe(false);
      });
    });

    describe('stageSpdifInputOn', () => {
      it('off on the first input switches the block off', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 3 });
        Staged.stageSpdifInputOn(s, 0, false);
        expect(s.staging.get('spdifBlock')?.value).toBe(false);
        expect(s.staging.has('spdifCount')).toBe(false);
      });

      it('off on a later input cuts the count to it, taking the inputs above along', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 4 });
        Staged.stageSpdifInputOn(s, 1, false);
        expect(s.staging.get('spdifCount')?.value).toBe(1);
        expect(s.staging.has('spdifBlock')).toBe(false);
      });

      it('on for the first input of an off block stages only the block, so the remembered count returns', async () => {
        const s = await bootWith({ spdifEnabled: false, spdifCount: 3 });
        Staged.stageSpdifInputOn(s, 0, true);
        expect(keys(s)).toEqual(['spdifBlock']);
      });

      it('on for input 2 of an off block with a remembered count of 4 gives a count of exactly 2', async () => {
        const s = await bootWith({ spdifEnabled: false, spdifCount: 4 });
        Staged.stageSpdifInputOn(s, 1, true);
        expect(s.staging.get('spdifBlock')?.value).toBe(true);
        expect(s.staging.get('spdifCount')?.value).toBe(2);
      });

      it('on while the block is on raises the count past the input but never lowers it', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 1 });
        Staged.stageSpdifInputOn(s, 2, true);
        expect(s.staging.get('spdifCount')?.value).toBe(3);
        Staged.stageSpdifInputOn(s, 1, true);
        expect(s.staging.get('spdifCount')?.value).toBe(3);
      });

      it('a staged block-off counts as off, so a later input switched on brings the block back', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 1 });
        Staged.stageSpdifInputOn(s, 0, false);
        Staged.stageSpdifInputOn(s, 1, true);
        expect(s.staging.has('spdifBlock')).toBe(false);
        expect(s.staging.get('spdifCount')?.value).toBe(2);
      });
    });

    describe('apply order', () => {
      it('a cut while the block is off lands before the block-on', async () => {
        const s = await bootWith({ spdifEnabled: false, spdifCount: 4 });
        Staged.stageSpdifInputOn(s, 1, true);
        expect(s.staging.get('spdifCount')!.order).toBeLessThan(s.staging.get('spdifBlock')!.order);
      });

      it('a raise lands after the block-on', async () => {
        const s = await bootWith({ spdifEnabled: false, spdifCount: 1 });
        Staged.stageSpdifInputOn(s, 2, true);
        expect(s.staging.get('spdifBlock')!.order).toBeLessThan(s.staging.get('spdifCount')!.order);
      });

      it('an I2S channel cut lands before a pin move can take what it frees', async () => {
        const s = await bootPaged();
        Object.assign(s.mirror.snapshot.inputConfig, { i2sEnabled: true, i2sInputChannels: 4 });
        Staged.stageI2sInputChannels(s, 2);
        Staged.stageSpdifRxPin(s, 25);
        expect(s.staging.get('i2sChannels')!.order).toBeLessThan(s.staging.get('spdifRxPin')!.order);
      });

      it('a channel cut on a running I2S input stays after pin moves, so the device refuses a taker', async () => {
        const s = await bootPaged();
        Object.assign(s.mirror.snapshot.inputConfig, { source: AudioInputSource.I2s, i2sEnabled: true, i2sInputChannels: 4 });
        Staged.stageI2sInputChannels(s, 2);
        Staged.stageSpdifRxPin(s, 25);
        expect(s.staging.get('spdifRxPin')!.order).toBeLessThan(s.staging.get('i2sChannels')!.order);
      });

      it('an I2S channel raise lands after the block-on', async () => {
        const s = await bootPaged();
        Object.assign(s.mirror.snapshot.inputConfig, { i2sEnabled: false, i2sInputChannels: 2 });
        Staged.stageI2sInputEnabled(s, true);
        Staged.stageI2sInputChannels(s, 4);
        expect(s.staging.get('i2sBlock')!.order).toBeLessThan(s.staging.get('i2sChannels')!.order);
      });

      it('an ADAT pin move lands before the S/PDIF block-on', async () => {
        const s = await bootWith({ spdifEnabled: false, spdifCount: 1 });
        Staged.stageSpdifInputOn(s, 0, true);
        Staged.stageAdatPin(s, 30);
        expect(s.staging.get('adatPin')!.order).toBeLessThan(s.staging.get('spdifBlock')!.order);
      });

      it('applying a block-on with a count raise leaves the device with both', async () => {
        const s = await bootWith({ spdifEnabled: true, spdifCount: 1 });
        await IoActions.setSpdifBlockEnabled(s, false);
        Staged.stageSpdifInputOn(s, 2, true);
        await s.staging.applyAll();
        expect(await s.device.getSpdifInputConfig()).toMatchObject({ enableMask: 0b0111 });
      });
    });

    it('a count raise onto a pin another function holds is refused and leaves the count', async () => {
      const profile = resolveMockProfile('v34', 'rp2040');
      await bootMock(profile.platform, profile.opts);
      const s = sess();
      expect(await s.device.setMckEnable(true)).toMatchObject({ ok: true });   // GP21, free while input 3 is off

      expect(await s.device.setSpdifInputCount(3)).toMatchObject({ ok: false });
      expect(await s.device.getSpdifInputConfig()).toMatchObject({ enableMask: 0b0001 });
    });

    describe('gappy 1.1.6 inputs', () => {
      // Inputs 1 and 3 on, input 2 off.
      async function bootGappy() {
        await bootMock('rp2350');
        const s = sess();
        Object.assign(s.mirror.snapshot.inputConfig, { spdifEnabled: true, spdifCount: 3, spdifHoles: 0b010, spdifRxPinExt: [20, 21, 0] });
        return s;
      }

      it('switching input 3 off cuts to input 1 and never turns input 2 on', async () => {
        const s = await bootGappy();
        Staged.stageSpdifInputOn(s, 2, false);
        expect(s.staging.get('spdifCount')?.value).toBe(1);
      });

      it('a cut sorts before a pin move onto the freed pin', async () => {
        const s = await bootGappy();
        Staged.stageSpdifInputOn(s, 2, false);
        Staged.stageI2sRxPin(s, 0, 21);
        expect(s.staging.get('spdifCount')!.order).toBeLessThan(s.staging.get('i2sRxPin:0')!.order);
      });

      it('a cut above a hole keeps only the unbroken run, so its pin is released before pin moves', async () => {
        const s = await bootGappy();
        Object.assign(s.mirror.snapshot.inputConfig, { spdifCount: 4, spdifRxPinExt: [20, 21, 22] });
        Staged.stageSpdifInputOn(s, 3, false);
        Staged.stageSpdifRxPin(s, 22);
        expect(s.staging.get('spdifCount')?.value).toBe(1);
        expect(s.staging.get('spdifCount')!.order).toBeLessThan(s.staging.get('spdifRxPin')!.order);
      });

      it('a cut above a hole still keeps the live source', async () => {
        const s = await bootGappy();
        Object.assign(s.mirror.snapshot.inputConfig, { spdifCount: 4, spdifRxPinExt: [20, 21, 22], source: AudioInputSource.Spdif3 });
        Staged.stageSpdifInputOn(s, 3, false);
        expect(s.staging.get('spdifCount')?.value).toBe(3);
      });

      it('switching the hole on closes it by staging the count even though the count is unchanged', async () => {
        const s = await bootGappy();
        Staged.stageSpdifInputOn(s, 1, true);
        expect(s.staging.get('spdifCount')?.value).toBe(3);
        expect(s.staging.overlaySnapshot(s.mirror.snapshot).inputConfig.spdifHoles).toBe(0);
      });

      it('picking the hole stages the count; picking a covered input stages nothing', async () => {
        const s = await bootGappy();
        Staged.stageInputSource(s, AudioInputSource.Spdif3);
        expect(s.staging.has('spdifCount')).toBe(false);
        Staged.stageInputSource(s, AudioInputSource.Spdif2);
        expect(s.staging.get('spdifCount')?.value).toBe(3);
      });

      it('the optimistic patch of a count write closes the holes', async () => {
        const s = await bootGappy();
        await IoActions.setSpdifInputCount(s, 3);
        expect(s.mirror.snapshot.inputConfig.spdifHoles).toBe(0);
      });

      it('input 1 has no off switch without block switches', async () => {
        const s = await bootGappy();
        Staged.stageSpdifInputOn(s, 0, false);
        expect(s.staging.entries).toEqual([]);
      });

      it('the legacy mock treats re-enabling an enabled input as a success', async () => {
        await bootMock('rp2350');
        const s = sess();
        expect(await s.device.setSpdifRxPin(21, 1)).toMatchObject({ ok: true });
        expect(await s.device.setSpdifInputCount(2)).toMatchObject({ ok: true });
        expect(await s.device.setSpdifInputCount(2)).toMatchObject({ ok: true });
        expect(await s.device.getSpdifInputConfig()).toMatchObject({ enableMask: 0b0011 });
      });
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

    it('applies an S/PDIF 3 repin before enabling MCK on the pin it frees', async () => {
      await bootMock('rp2040', { spdifInputsEnabled: 3 });
      const s = sess();
      expect(s.mirror.snapshot.i2s.mckPin).toBe(21);
      expect(s.mirror.snapshot.inputConfig.spdifRxPinExt[1]).toBe(21);

      Staged.stageMckEnabled(s, true);
      Staged.stageSpdifRxPinExt(s, 1, 26);
      await s.staging.applyAll();

      expect(s.mirror.snapshot.inputConfig.spdifRxPinExt[1]).toBe(26);
      expect(s.mirror.snapshot.i2s.mckEnabled).toBe(true);
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
    await bootMock('rp2350', { wireVersion: Wire.MAX_WIRE_VERSION, fw116Release: true });
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

describe('runtime/stagedActions: stageInputSourceName', () => {
  beforeEach(async () => {
    await bootMock('rp2350', { wireVersion: Wire.MAX_WIRE_VERSION, fw116Release: true });
  });

  it('re-staging the live name discards the entry, even with surrounding spaces', () => {
    const s = sess();
    s.names.inputSources[AudioInputSource.Usb] = 'Desk';
    Staged.stageInputSourceName(s, AudioInputSource.Usb, 'Studio');
    expect(s.staging.has(`inputSourceName:${AudioInputSource.Usb}`)).toBe(true);
    Staged.stageInputSourceName(s, AudioInputSource.Usb, '  Desk ');
    expect(s.staging.has(`inputSourceName:${AudioInputSource.Usb}`)).toBe(false);
  });

  it('applies several staged names in one batch, writing each to the device', async () => {
    const s = sess();
    const spy = vi.spyOn(s.device, 'setInputSourceName');
    Staged.stageInputSourceName(s, AudioInputSource.Usb, 'Desk');
    Staged.stageInputSourceName(s, AudioInputSource.I2s, 'Turntable');
    expect(spy).not.toHaveBeenCalled();
    await s.staging.applyAll();
    expect(spy).toHaveBeenCalledWith(AudioInputSource.Usb, 'Desk');
    expect(spy).toHaveBeenCalledWith(AudioInputSource.I2s, 'Turntable');
    expect(s.names.inputSources[AudioInputSource.I2s]).toBe('Turntable');
    expect(s.staging.entries.length).toBe(0);
  });
});

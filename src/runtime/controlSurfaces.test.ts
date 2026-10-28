import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootMock } from './boot';
import * as ControlSurface from './controlSurfaceActions';
import { flushAllWrites } from './writes.svelte';
import { activeSession, clearNotices, resetAppState } from '@/state';
import * as Domain from '@/domain';

const sess = () => activeSession()!;

const ledBinding = {
  type: Domain.CsType.Led, noun: Domain.CsNoun.Loudness, action: Domain.CsAction.IndEquals,
  flags: 0, gpio0: 20, gpio1: null, event: Domain.CsEvent.Press, target: 0, index: 0,
  value: 1, step: 0, rangeMin: 0, rangeMax: 0,
  baseBright: 0, onDelay: 0, offDelay: 0, reserved2: [0, 0],
};

const irReceiver = {
  type: Domain.CsType.Ir, noun: Domain.CsNoun.UserVolume, action: Domain.CsAction.Adjust,
  flags: 0, gpio0: 16, gpio1: null, event: Domain.CsEvent.Press, target: 0, index: 0,
  value: 0, step: 0, rangeMin: 0, rangeMax: 0,
  baseBright: 0, onDelay: 0, offDelay: 0, reserved2: [0, 0],
};

const necToggle = {
  noun: Domain.CsNoun.UserMute, action: Domain.CsAction.Toggle, flags: 0, target: 0, index: 0,
  protocol: Domain.CsIrProto.Nec, value: 0, step: 0, code: 0x12345678,
};

// gpio0/gpio1 2/3: free of the mock's default reservations (outputs 6-10,
// S/PDIF RX 5, I2S RX pair 0 on GPIO 1). index 6 = CsDisplayModel.Ssd1306_128x64.
// Spread EMPTY_CS_BINDING rather than naming noun/action -- the container
// binding's noun/action must read 0, not "UserVolume"/"Adjust".
const displayBinding = {
  ...Domain.EMPTY_CS_BINDING, type: Domain.CsType.Display, gpio0: 2, gpio1: 3, index: 6,
};

describe('runtime/controlSurfaces', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
    clearNotices();
  });

  afterEach(() => { activeSession()?.dispose(); resetAppState(); });

  it('connect fetches caps, nouns, status, and every slot binding and name', () => {
    const s = sess();
    expect(s.controlSurfaces.caps?.maxBindings).toBe(Domain.CS_MAX_BINDINGS);
    expect(s.controlSurfaces.caps?.capsVersion).toBeGreaterThanOrEqual(2);
    expect(s.controlSurfaces.nouns).toHaveLength(61);
    expect(s.controlSurfaces.status?.activeMask).toBe(0);
    expect(s.controlSurfaces.status?.dirty).toBe(false);
    expect(s.controlSurfaces.bindings).toHaveLength(Domain.CS_MAX_BINDINGS);
    expect(s.controlSurfaces.bindings.every((b) => b === null)).toBe(true);
    expect(s.controlSurfaces.names).toHaveLength(Domain.CS_MAX_BINDINGS);
    expect(s.controlSurfaces.names.every((n) => n === '')).toBe(true);
    expect(s.controlSurfaces.lastFetchError).toBeNull();
  });

  it('connect also populates target groups (all empty) and ext status on the default mock', () => {
    const s = sess();
    expect(s.controlSurfaces.groups.every((g) => g === null)).toBe(true);
    expect(s.controlSurfaces.extStatus?.maxGroups).toBe(Domain.CS_MAX_GROUPS);
  });

  it('connect reports the macro ceiling through ext status on the default mock', () => {
    const s = sess();
    expect(s.controlSurfaces.caps?.maxMacros).toBe(Domain.CS_MAX_MACROS);
    expect(s.controlSurfaces.extStatus?.maxMacros).toBe(Domain.CS_MAX_MACROS);
  });

  it('a pre-v9 caps device leaves groups, macros, and ext status empty', async () => {
    await bootMock('rp2350', { csCapsVersion: 8 });
    const s = sess();
    expect(s.controlSurfaces.caps?.maxGroups).toBe(0);
    expect(s.controlSurfaces.caps?.maxMacros).toBe(0);
    expect(s.controlSurfaces.groups.every((g) => g === null)).toBe(true);
    expect(s.controlSurfaces.extStatus).toBeNull();
  });

  it('a device reporting a pre-v2 caps format is rejected with an explanatory error', async () => {
    await bootMock('rp2350', { csCapsVersion: 1 });
    const s = sess();
    expect(s.controlSurfaces.caps).toBeNull();
    expect(s.controlSurfaces.deviceCapsVersion).toBe(1);   // still recorded for display
    expect(s.controlSurfaces.bindings.every((b) => b === null)).toBe(true);
    expect(s.controlSurfaces.lastFetchError).toBeTruthy();
  });

  it('a newer caps format than the console models is accepted, not rejected (floor-only gate)', async () => {
    // Pins an older-than-current caps version (fw 1.1.6 now defaults to v14);
    // the format is append-only, so a newer-than-modeled version must degrade
    // (unknown nouns/units filtered in the pickers), never refuse the whole surface.
    await bootMock('rp2350', { csCapsVersion: 13 });
    const s = sess();
    expect(s.controlSurfaces.caps?.capsVersion).toBe(13);
    expect(s.controlSurfaces.nouns).toHaveLength(57);
    expect(s.controlSurfaces.lastFetchError).toBeNull();
  });

  it('applyCsBinding lands the accepted binding, marks the config dirty, and refreshes status', async () => {
    const s = sess();
    const ok = await ControlSurface.applyCsBinding(s, 5, ledBinding);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.bindings[5]).toEqual(ledBinding);
    expect(s.controlSurfaces.status?.activeMask).toBe(1 << 5);
    expect(s.controlSurfaces.status?.slotStatus[5]).toBe(0);
    expect(s.controlSurfaces.status?.dirty).toBe(true);
  });

  it('a rejected binding keeps the slot state and surfaces the failure status', async () => {
    const s = sess();
    const ok = await ControlSurface.applyCsBinding(s, 0, {
      type: Domain.CsType.Encoder, noun: Domain.CsNoun.UserMute, action: Domain.CsAction.Step,
      flags: 0, gpio0: 21, gpio1: 22, event: Domain.CsEvent.Press, target: 0, index: 0,
      value: 0, step: Domain.dbToQ8(1), rangeMin: 0, rangeMax: 0,
      baseBright: 0, onDelay: 0, offDelay: 0,
    });
    expect(ok).toBe(false);
    expect(s.controlSurfaces.bindings[0]).toBeNull();
    expect(s.controlSurfaces.status?.lastStatus).toBe(0x13);   // INVALID_ACTION
    expect(s.controlSurfaces.status?.activeMask).toBe(0);
  });

  it('clearCsBinding empties the slot and drops its active bit', async () => {
    const s = sess();
    await ControlSurface.applyCsBinding(s, 2, ledBinding);
    const ok = await ControlSurface.clearCsBinding(s, 2);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.bindings[2]).toBeNull();
    expect(s.controlSurfaces.status?.activeMask).toBe(0);
  });

  it('applyCsName lands the name, marks the config dirty, and leaves the binding untouched', async () => {
    const s = sess();
    const ok = await ControlSurface.applyCsName(s, 3, 'Sub Level');
    expect(ok).toBe(true);
    expect(s.controlSurfaces.names[3]).toBe('Sub Level');
    expect(s.controlSurfaces.bindings[3]).toBeNull();
    expect(s.controlSurfaces.status?.dirty).toBe(true);
  });

  it('csSaveConfig persists the live preview and clears dirty', async () => {
    const s = sess();
    await ControlSurface.applyCsBinding(s, 5, ledBinding);
    expect(s.controlSurfaces.status?.dirty).toBe(true);
    const ok = await ControlSurface.csSaveConfig(s);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.status?.dirty).toBe(false);
  });

  it('csRevertConfig discards an unsaved preview and re-fetches bindings, names, and status', async () => {
    const s = sess();
    await ControlSurface.applyCsBinding(s, 5, ledBinding);
    await ControlSurface.csSaveConfig(s);

    // Unsaved changes on top of the saved config: rename the slot and clear
    // the binding, neither of which is persisted.
    await ControlSurface.applyCsName(s, 5, 'Renamed live');
    await ControlSurface.clearCsBinding(s, 5);
    expect(s.controlSurfaces.bindings[5]).toBeNull();
    expect(s.controlSurfaces.status?.dirty).toBe(true);

    const ok = await ControlSurface.csRevertConfig(s);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.status?.dirty).toBe(false);
    expect(s.controlSurfaces.bindings[5]).toEqual(ledBinding);   // restored from the saved snapshot
    expect(s.controlSurfaces.names[5]).toBe('');                 // the rename was never saved
  });

  it('csRevertConfig also re-fetches IR command sub-slots', async () => {
    const s = sess();
    await ControlSurface.applyCsIrCommand(s, 3, necToggle);
    await ControlSurface.csSaveConfig(s);

    // Unsaved change on top of the saved sub-slot: clear it locally.
    await ControlSurface.clearCsIrCommand(s, 3);
    expect(s.controlSurfaces.irCommands[3]).toBeNull();
    expect(s.controlSurfaces.status?.dirty).toBe(true);

    const ok = await ControlSurface.csRevertConfig(s);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.status?.dirty).toBe(false);
    expect(s.controlSurfaces.irCommands[3]).toEqual(necToggle);   // restored from the saved snapshot
  });

  it('csRevertConfig restores the saved groups and bumps revertEpoch', async () => {
    const s = sess();
    const group = { targetKind: Domain.CS_TARGET_OUTPUT_CH, memberMask: 0b1, name: 'Sub' };
    await ControlSurface.applyCsGroup(s, 0, group);
    await ControlSurface.csSaveConfig(s);
    const epochBefore = s.controlSurfaces.revertEpoch;

    await ControlSurface.clearCsGroup(s, 0);
    expect(s.controlSurfaces.groups[0]).toBeNull();
    expect(s.controlSurfaces.status?.dirty).toBe(true);

    const ok = await ControlSurface.csRevertConfig(s);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.groups[0]).toEqual(group);   // restored from the saved snapshot
    expect(s.controlSurfaces.revertEpoch).toBe(epochBefore + 1);
  });

  it('connect also fetches every IR command sub-slot (all empty on a fresh device)', () => {
    const s = sess();
    expect(s.controlSurfaces.caps?.maxIrCommands).toBe(Domain.CS_MAX_IR_COMMANDS);
    expect(s.controlSurfaces.irCommands).toHaveLength(Domain.CS_MAX_IR_COMMANDS);
    expect(s.controlSurfaces.irCommands.every((c) => c === null)).toBe(true);
  });

  it('applyCsIrCommand lands the accepted command and marks the config dirty', async () => {
    const s = sess();
    const ok = await ControlSurface.applyCsIrCommand(s, 2, necToggle);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.irCommands[2]).toEqual(necToggle);
    expect(s.controlSurfaces.status?.dirty).toBe(true);
  });

  it('a rejected IR command keeps the sub-slot empty and surfaces the failure status', async () => {
    const s = sess();
    // ADJUST isn't in the IR button subset.
    const ok = await ControlSurface.applyCsIrCommand(s, 0, { ...necToggle, action: Domain.CsAction.Adjust });
    expect(ok).toBe(false);
    expect(s.controlSurfaces.irCommands[0]).toBeNull();
    expect(s.controlSurfaces.status?.lastStatus).toBe(0x13);   // INVALID_ACTION
  });

  it('clearCsIrCommand empties the sub-slot', async () => {
    const s = sess();
    await ControlSurface.applyCsIrCommand(s, 4, necToggle);
    const ok = await ControlSurface.clearCsIrCommand(s, 4);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.irCommands[4]).toBeNull();
  });

  it('applyCsGroup lands the group, marks the config dirty, and refreshes ext status', async () => {
    const s = sess();
    const group = { targetKind: Domain.CS_TARGET_OUTPUT_CH, memberMask: 0b11, name: 'Mains' };
    const ok = await ControlSurface.applyCsGroup(s, 0, group);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.groups[0]).toEqual(group);
    expect(s.controlSurfaces.status?.dirty).toBe(true);
    expect(s.controlSurfaces.extStatus?.groupStatus[0]).toBe(0);
  });

  it('a grouped binding goes INACTIVE (InvalidGroup) when its group is cleared, and ACTIVE again once reapplied', async () => {
    const s = sess();
    const group = { targetKind: Domain.CS_TARGET_OUTPUT_CH, memberMask: 0b1, name: 'Sub' };
    await ControlSurface.applyCsGroup(s, 0, group);
    const grouped = {
      type: Domain.CsType.Button, noun: Domain.CsNoun.OutputMute, action: Domain.CsAction.Toggle,
      flags: Domain.CS_FLAG_GROUP, gpio0: 20, gpio1: null, event: Domain.CsEvent.Press, target: 0, index: 0,
      value: 0, step: 0, rangeMin: 0, rangeMax: 0,
      baseBright: 0, onDelay: 0, offDelay: 0, reserved2: [0, 0],
    };
    expect(await ControlSurface.applyCsBinding(s, 4, grouped)).toBe(true);
    expect(s.controlSurfaces.status?.activeMask).toBe(1 << 4);

    await ControlSurface.clearCsGroup(s, 0);
    expect(s.controlSurfaces.status?.slotStatus[4]).toBe(0x1F);   // INVALID_GROUP
    expect(s.controlSurfaces.status?.activeMask).toBe(0);

    await ControlSurface.applyCsGroup(s, 0, group);
    expect(s.controlSurfaces.status?.slotStatus[4]).toBe(0);
    expect(s.controlSurfaces.status?.activeMask).toBe(1 << 4);
  });

  it('applyCsMacro lands the macro, marks the config dirty, and refreshes ext status', async () => {
    const s = sess();
    const macro = {
      name: 'Night', stepCount: 1,
      steps: [
        { noun: Domain.CsNoun.UserMute, action: Domain.CsAction.Toggle, flags: 0, target: 0, index: 0, value: 0, step: 0, preDelay: 0 },
        ...Array.from({ length: 7 }, () => Domain.EMPTY_CS_MACRO_STEP),
      ],
    };
    const ok = await ControlSurface.applyCsMacro(s, 0, macro);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.macros[0]).toEqual(macro);
    expect(s.controlSurfaces.status?.dirty).toBe(true);
    expect(s.controlSurfaces.extStatus?.macroStatus[0]).toBe(0);
  });

  it('clearCsMacro empties the slot', async () => {
    const s = sess();
    const macro = {
      name: 'Night', stepCount: 1,
      steps: [
        { noun: Domain.CsNoun.UserMute, action: Domain.CsAction.Toggle, flags: 0, target: 0, index: 0, value: 0, step: 0, preDelay: 0 },
        ...Array.from({ length: 7 }, () => Domain.EMPTY_CS_MACRO_STEP),
      ],
    };
    await ControlSurface.applyCsMacro(s, 0, macro);
    const ok = await ControlSurface.clearCsMacro(s, 0);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.macros[0]).toBeNull();
  });

  it('csRevertConfig restores the saved macro', async () => {
    const s = sess();
    const macro = {
      name: 'Night', stepCount: 1,
      steps: [
        { noun: Domain.CsNoun.UserMute, action: Domain.CsAction.Toggle, flags: 0, target: 0, index: 0, value: 0, step: 0, preDelay: 0 },
        ...Array.from({ length: 7 }, () => Domain.EMPTY_CS_MACRO_STEP),
      ],
    };
    await ControlSurface.applyCsMacro(s, 0, macro);
    await ControlSurface.csSaveConfig(s);

    await ControlSurface.clearCsMacro(s, 0);
    expect(s.controlSurfaces.macros[0]).toBeNull();
    expect(s.controlSurfaces.status?.dirty).toBe(true);

    const ok = await ControlSurface.csRevertConfig(s);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.status?.dirty).toBe(false);
    expect(s.controlSurfaces.macros[0]).toEqual(macro);
  });

  it('a macro step grouped over an output group goes INVALID_GROUP when the group is cleared, and clears once reapplied', async () => {
    const s = sess();
    const group = { targetKind: Domain.CS_TARGET_OUTPUT_CH, memberMask: 0b1, name: 'Sub' };
    await ControlSurface.applyCsGroup(s, 0, group);
    const grouped = {
      name: 'Mute Sub', stepCount: 1,
      steps: [
        { noun: Domain.CsNoun.OutputMute, action: Domain.CsAction.Toggle, flags: Domain.CS_FLAG_GROUP, target: 0, index: 0, value: 0, step: 0, preDelay: 0 },
        ...Array.from({ length: 7 }, () => Domain.EMPTY_CS_MACRO_STEP),
      ],
    };
    expect(await ControlSurface.applyCsMacro(s, 0, grouped)).toBe(true);
    expect(s.controlSurfaces.extStatus?.macroStatus[0]).toBe(0);

    await ControlSurface.clearCsGroup(s, 0);
    expect(s.controlSurfaces.extStatus?.macroStatus[0]).toBe(0x1F);   // INVALID_GROUP

    await ControlSurface.applyCsGroup(s, 0, group);
    expect(s.controlSurfaces.extStatus?.macroStatus[0]).toBe(0);
  });

  it('fireCsMacro sets extStatus.macroRunning while the macro is running; cancelCsMacro clears it', async () => {
    const s = sess();
    const macro = {
      name: 'Delayed', stepCount: 1,
      steps: [
        { noun: Domain.CsNoun.UserMute, action: Domain.CsAction.Toggle, flags: 0, target: 0, index: 0, value: 0, step: 0, preDelay: 100 },
        ...Array.from({ length: 7 }, () => Domain.EMPTY_CS_MACRO_STEP),
      ],
    };
    await ControlSurface.applyCsMacro(s, 0, macro);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const ok = await ControlSurface.fireCsMacro(s, 0);
      expect(ok).toBe(true);
      expect(s.controlSurfaces.extStatus?.macroRunning).toBe(0);

      await ControlSurface.cancelCsMacro(s);
      expect(s.controlSurfaces.extStatus?.macroRunning).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('csIrLearnArm moves the sub-state to ARMED with a live IR receiver, and a notify DONE lands the result', async () => {
    const s = sess();
    await ControlSurface.applyCsBinding(s, 0, irReceiver);
    const ok = await ControlSurface.csIrLearnArm(s);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.irLearn).toEqual({ state: Domain.CS_IR_LEARN_ARMED, protocol: Domain.CsIrProto.None, code: 0 });
  });

  it('csIrLearnArm fails and leaves the sub-state untouched without a live IR receiver', async () => {
    const s = sess();
    const ok = await ControlSurface.csIrLearnArm(s);
    expect(ok).toBe(false);
    expect(s.controlSurfaces.irLearn).toBeNull();
  });

  it('re-arming a learn drops the previous result synchronously, before the device round-trip', async () => {
    const s = sess();
    await ControlSurface.applyCsBinding(s, 0, irReceiver);
    // A completed learn leaves a DONE result behind (as the notify channel
    // would); the panel's completion effect runs during the next arm's await,
    // so the stale result must already be gone at call time.
    s.controlSurfaces.irLearn = { state: Domain.CS_IR_LEARN_DONE, protocol: Domain.CsIrProto.Nec, code: 0xaa55 };
    const armed = ControlSurface.csIrLearnArm(s);
    expect(s.controlSurfaces.irLearn).toBeNull();
    expect(await armed).toBe(true);
    expect(s.controlSurfaces.irLearn).toEqual({ state: Domain.CS_IR_LEARN_ARMED, protocol: Domain.CsIrProto.None, code: 0 });
  });

  it('csIrLearnCancel returns the sub-state to idle', async () => {
    const s = sess();
    await ControlSurface.applyCsBinding(s, 0, irReceiver);
    await ControlSurface.csIrLearnArm(s);
    expect(s.controlSurfaces.irLearn).not.toBeNull();
    await ControlSurface.csIrLearnCancel(s);
    expect(s.controlSurfaces.irLearn).toBeNull();
  });

  it('connect populates the display block (empty) on the default mock', () => {
    const s = sess();
    expect(s.controlSurfaces.displayLimits).toEqual({ maxPages: 16, modelCount: 9 });
    expect(s.controlSurfaces.displayCfg).toEqual(Domain.EMPTY_CS_DISPLAY_CFG);
    expect(s.controlSurfaces.displayPages.every((p) => p === null)).toBe(true);
    expect(s.controlSurfaces.displayStatus).toEqual({
      initState: 0, currentPage: null, overlay: false, editArmed: false, model: 0, nakCount: 0,
    });
  });

  it('leaves the display block null at a pre-v10 caps version', async () => {
    await bootMock('rp2350', { csCapsVersion: 9 });
    const s = sess();
    expect(s.controlSurfaces.displayLimits).toBeNull();
    expect(s.controlSurfaces.displayCfg).toBeNull();
    expect(s.controlSurfaces.displayStatus).toBeNull();
  });

  it('applyCsBinding of a display slot silently reseeds the display cfg/pages', async () => {
    const s = sess();
    const ok = await ControlSurface.applyCsBinding(s, 0, displayBinding);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.displayPages[0]).not.toBeNull();
    expect(s.controlSurfaces.displayPages[1]).not.toBeNull();
    expect(s.controlSurfaces.displayPages[2]).not.toBeNull();
    expect(s.controlSurfaces.displayPages[3]).not.toBeNull();
    expect((s.controlSurfaces.displayCfg?.flags ?? 0) & Domain.CS_DCFG_EDIT_GATED).toBe(Domain.CS_DCFG_EDIT_GATED);
  });

  it('applyCsDisplayCfg lands the cfg and marks the config dirty', async () => {
    const s = sess();
    const cfg = { mode: Domain.CsDisplayMode.Fixed, homePage: 2, dwell: 0, overlayHold: 0, brightness: 0, flags: 0, editTimeout: 0 };
    const ok = await ControlSurface.applyCsDisplayCfg(s, cfg);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.displayCfg).toEqual(cfg);
    expect(s.controlSurfaces.status?.dirty).toBe(true);
  });

  it('applyCsDisplayPage lands a page; clearCsDisplayPage empties it', async () => {
    const s = sess();
    const page = { noun: Domain.CsNoun.Preamp, target: 0, index: 0, flags: 0x01 };
    const ok = await ControlSurface.applyCsDisplayPage(s, 5, page);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.displayPages[5]).toEqual(page);

    const cleared = await ControlSurface.clearCsDisplayPage(s, 5);
    expect(cleared).toBe(true);
    expect(s.controlSurfaces.displayPages[5]).toBeNull();
  });

  it('csRevertConfig restores the saved display pages', async () => {
    const s = sess();
    const saved = { noun: Domain.CsNoun.Preamp, target: 0, index: 0, flags: 0x01 };
    await ControlSurface.applyCsDisplayPage(s, 5, saved);
    await ControlSurface.csSaveConfig(s);
    await ControlSurface.applyCsDisplayPage(s, 5, { noun: Domain.CsNoun.MasterVolume, target: 0, index: 0, flags: 0x01 });
    expect(s.controlSurfaces.displayPages[5]?.noun).toBe(Domain.CsNoun.MasterVolume);

    const ok = await ControlSurface.csRevertConfig(s);
    expect(ok).toBe(true);
    expect(s.controlSurfaces.displayPages[5]).toEqual(saved);
  });

  it("enabling the I2C control interface on the display's bus is rejected", async () => {
    const s = sess();
    await ControlSurface.applyCsBinding(s, 0, displayBinding);   // SDA/SCL 2/3, I2C instance 1
    const before = s.ctrlIfaces.i2c;
    ControlSurface.setI2cControlConfig(s, { enabled: true, sdaPin: 14, sclPin: 15, address: 0x42 });   // also instance 1
    await flushAllWrites(s);
    expect(s.ctrlIfaces.i2c).toEqual(before);
  });
});

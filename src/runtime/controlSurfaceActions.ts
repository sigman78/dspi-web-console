import * as Domain from '@/domain';
import { type ReadySession, pushNotice } from '@/state';
import { command } from './writes.svelte';
import { readCsDisplayBlock, readCsAll } from './deviceService';

// V16 — external control interfaces (UART / I2C). The SET's result is only
// known from the device's read-back status (see DspDevice.setUartControlConfig),
// so this can't be a plain writeChecked: the status must land in ctrlIfaces
// on BOTH branches (a rejected pin/baud is still useful to show as
// last-status text), whereas writeChecked's patch only runs on ok.
export function setUartControlConfig(s: ReadySession, cfg: Domain.UartControlConfig): void {
  void command(s, 'set UART control config',
    () => s.device.setUartControlConfig(cfg),
    (r, s) => {
      s.ctrlIfaces.status = r.status;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.ctrlIfaces.uart = cfg;
    },
  );
}

export function setI2cControlConfig(s: ReadySession, cfg: Domain.I2cControlConfig): void {
  void command(s, 'set I2C control config',
    () => s.device.setI2cControlConfig(cfg),
    (r, s) => {
      s.ctrlIfaces.status = r.status;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.ctrlIfaces.i2c = cfg;
    },
  );
}

// V16 — Control Surfaces binding apply (0x84 + status poll). Immediate lane
// like the UART/I2C config above: a binding apply never restarts the audio
// path, so it bypasses the staged-apply gate. The polled status read-back
// must land in state on BOTH branches (a rejection is exactly what the panel
// needs to show), and the slot's live binding is re-read regardless of
// outcome -- on failure the firmware keeps and reports the previous one.
// Resolves true only when the device accepted the binding.
export async function applyCsBinding(s: ReadySession, slot: number, binding: Domain.CsBinding): Promise<boolean> {
  let ok = false;
  // Attaching or detaching a display silently reseeds its cfg/pages (fw
  // disp_seed_pages runs without setting dirty), so the display block is
  // re-read inside the same queued send whenever this binding touches type
  // Display -- either as the new type or the one it's replacing.
  const wasDisplay = s.controlSurfaces.bindings[slot]?.type === Domain.CsType.Display;
  const touchesDisplay = (binding.type === Domain.CsType.Display || wasDisplay) &&
    Domain.csDisplaysAvailable(s.controlSurfaces.caps);
  await command(s, 'set control-surface binding',
    async () => {
      const r = await s.device.setCsBinding(slot, binding);
      const live = await s.device.getCsBinding(slot);
      const display = touchesDisplay && r.result.ok ? await readCsDisplayBlock(s.device) : null;
      return { result: r.result, status: r.status, live, display };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.bindings[slot] = r.live.type === Domain.CsType.None ? null : r.live;
      if (r.display) {
        s.controlSurfaces.displayLimits = r.display.limits;
        s.controlSurfaces.displayCfg = r.display.cfg;
        s.controlSurfaces.displayPages = r.display.pages;
        s.controlSurfaces.displayStatus = r.display.status;
      }
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.controlSurfaces.changed.bindings = true;
      ok = true;
    },
  );
  return ok;
}

export function clearCsBinding(s: ReadySession, slot: number): Promise<boolean> {
  return applyCsBinding(s, slot, Domain.EMPTY_CS_BINDING);
}

// caps v9 — target group apply (0x20 + status poll, reported in
// last_slot as 0x40 | group). Same shape as applyCsBinding, plus a fresh
// ext-status read: the poll's status already carries the re-validated
// activeMask/slotStatus of dependent bindings/IR commands.
export async function applyCsGroup(s: ReadySession, idx: number, g: Domain.CsGroup): Promise<boolean> {
  let ok = false;
  await command(s, 'set control-surface group',
    async () => {
      const r = await s.device.setCsGroup(idx, g);
      const live = await s.device.getCsGroup(idx);
      const extStatus = await s.device.getCsExtStatus();
      return { result: r.result, status: r.status, live, extStatus };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.groups[idx] = r.live.targetKind === Domain.CS_TARGET_NONE ? null : r.live;
      s.controlSurfaces.extStatus = r.extStatus;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.controlSurfaces.changed.groups = true;
      ok = true;
    },
  );
  return ok;
}

export function clearCsGroup(s: ReadySession, idx: number): Promise<boolean> {
  return applyCsGroup(s, idx, Domain.EMPTY_CS_GROUP);
}

// caps v9 — macro apply (0x22 header + 0x24 steps, then status poll, reported
// in last_slot as 0x60 | macro). Same shape as applyCsGroup: the macro and
// ext status are re-read regardless of outcome, so a step that failed
// mid-write shows exactly what landed on the device.
export async function applyCsMacro(s: ReadySession, idx: number, m: Domain.CsMacro): Promise<boolean> {
  let ok = false;
  await command(s, 'set control-surface macro',
    async () => {
      const r = await s.device.setCsMacro(idx, m);
      const live = await s.device.getCsMacro(idx);
      const extStatus = await s.device.getCsExtStatus();
      return { result: r.result, status: r.status, live, extStatus };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.macros[idx] = Domain.csMacroIsEmpty(r.live) ? null : r.live;
      s.controlSurfaces.extStatus = r.extStatus;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.controlSurfaces.changed.macros = true;
      ok = true;
    },
  );
  return ok;
}

export function clearCsMacro(s: ReadySession, idx: number): Promise<boolean> {
  return applyCsMacro(s, idx, Domain.EMPTY_CS_MACRO);
}

// caps v9 — fire a macro (0x25, GET-style action, no status poll), then
// refresh ext status so the RUNNING pill and step hint land immediately.
export async function fireCsMacro(s: ReadySession, idx: number): Promise<boolean> {
  let ok = false;
  await command(s, 'fire control-surface macro',
    async () => {
      const result = await s.device.csMacroFire(idx);
      const extStatus = await s.device.getCsExtStatus();
      return { result, extStatus };
    },
    (r, s) => {
      s.controlSurfaces.extStatus = r.extStatus;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      ok = true;
    },
  );
  return ok;
}

// Cancel the running macro (0x25, wValue 0xFFFF); always succeeds on a live
// device, so there is nothing to report beyond the refreshed ext status.
export async function cancelCsMacro(s: ReadySession): Promise<void> {
  await command(s, 'cancel control-surface macro',
    async () => {
      await s.device.csMacroCancel();
      return s.device.getCsExtStatus();
    },
    (extStatus, s) => { s.controlSurfaces.extStatus = extStatus; },
  );
}

// Ext-status refresh for the MACROS panel's running-macro poll. A plain
// queued read, deliberately outside `command`: a failed tick is dropped
// without a toast or a link-health mark, the next tick simply reads again.
export async function refreshCsExtStatus(s: ReadySession): Promise<void> {
  try {
    const extStatus = await s.queue.run(() => s.device.getCsExtStatus());
    if (s.alive) s.controlSurfaces.extStatus = extStatus;
  } catch {
    // dropped: the poll retries on its next tick
  }
}

// caps v10+ — I2C display settings apply (0x27 + status poll, reported in
// last_slot 0x50). No display binding is required to configure this in
// advance -- the blob is live whether or not a display is attached.
export async function applyCsDisplayCfg(s: ReadySession, cfg: Domain.CsDisplayCfg): Promise<boolean> {
  let ok = false;
  await command(s, 'set control-surface display config',
    async () => {
      const r = await s.device.setCsDisplayCfg(cfg);
      const { limits, cfg: live } = await s.device.getCsDisplayCfg();
      const displayStatus = await s.device.getCsDisplayStatus();
      return { result: r.result, status: r.status, limits, live, displayStatus };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.displayLimits = r.limits;
      s.controlSurfaces.displayCfg = r.live;
      s.controlSurfaces.displayStatus = r.displayStatus;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.controlSurfaces.changed.display = true;
      ok = true;
    },
  );
  return ok;
}

// caps v10+ — one display page apply (0x29 + status poll, reported in
// last_slot 0x50 | page). Same no-binding-required rule as the cfg above.
export async function applyCsDisplayPage(s: ReadySession, idx: number, p: Domain.CsDisplayPage): Promise<boolean> {
  let ok = false;
  await command(s, 'set control-surface display page',
    async () => {
      const r = await s.device.setCsDisplayPage(idx, p);
      const live = await s.device.getCsDisplayPage(idx);
      const displayStatus = await s.device.getCsDisplayStatus();
      return { result: r.result, status: r.status, live, displayStatus };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.displayPages[idx] = Domain.csDisplayPageIsEmpty(r.live) ? null : r.live;
      s.controlSurfaces.displayStatus = r.displayStatus;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.controlSurfaces.changed.display = true;
      ok = true;
    },
  );
  return ok;
}

export function clearCsDisplayPage(s: ReadySession, idx: number): Promise<boolean> {
  return applyCsDisplayPage(s, idx, Domain.EMPTY_CS_DISPLAY_PAGE);
}

// Status refresh for the DISPLAY panel's live poll. A plain queued read,
// deliberately outside `command`, mirroring refreshCsExtStatus.
export async function refreshCsDisplayStatus(s: ReadySession): Promise<void> {
  try {
    const status = await s.queue.run(() => s.device.getCsDisplayStatus());
    if (s.alive) s.controlSurfaces.displayStatus = status;
  } catch {
    // dropped: the poll retries on its next tick
  }
}

// V16 — Control Surfaces slot name (0x8B + status poll). Names are slot
// metadata independent of the binding, so this is its own deferred apply on
// the same shared status channel as the binding SET. Resolves true only when
// the device accepted the name.
export async function applyCsName(s: ReadySession, slot: number, name: string): Promise<boolean> {
  let ok = false;
  await command(s, 'set control-surface name',
    async () => {
      const r = await s.device.setCsName(slot, name);
      const live = await s.device.getCsName(slot);
      return { result: r.result, status: r.status, live };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.names[slot] = r.live;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.controlSurfaces.changed.bindings = true;
      ok = true;
    },
  );
  return ok;
}

// V16 — persist the whole live Control Surfaces preview (bindings + names) to
// flash and clear `dirty`. Resolves true only on success; failure (BUSY, a
// flash write error) surfaces as a warn toast and leaves the preview live.
export async function csSaveConfig(s: ReadySession): Promise<boolean> {
  let ok = false;
  await command(s, 'save control-surface config',
    () => s.device.csSave(),
    (r, s) => {
      s.controlSurfaces.status = r.status;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.controlSurfaces.changed = { bindings: false, groups: false, macros: false, display: false };
      ok = true;
    },
  );
  return ok;
}

// V16 — discard the live Control Surfaces preview and re-apply the stored
// config. The device rewinds every slot's binding and name, and every IR
// command sub-slot, to what was last saved, so this re-fetches all of them
// (plus status) rather than trusting whatever the panel's local drafts were
// showing. Bounds come from the connect-time caps (not the revert response),
// same as the initial fetch in deviceService.ts's fetchControlSurfaces.
export async function csRevertConfig(s: ReadySession): Promise<boolean> {
  let ok = false;
  const caps = s.controlSurfaces.caps;
  await command(s, 'revert control-surface config',
    async () => {
      const r = await s.device.csRevert();
      const all = r.result.ok && caps ? await readCsAll(s.device, caps, (f) => f()) : null;
      return { result: r.result, status: r.status, all };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      if (r.all) {
        s.controlSurfaces.bindings = r.all.bindings;
        s.controlSurfaces.names = r.all.names;
        if (r.all.irCommands) s.controlSurfaces.irCommands = r.all.irCommands;
        if (r.all.groups) s.controlSurfaces.groups = r.all.groups;
        if (r.all.macros) s.controlSurfaces.macros = r.all.macros;
        if (r.all.extStatus) s.controlSurfaces.extStatus = r.all.extStatus;
        if (r.all.display) {
          s.controlSurfaces.displayLimits = r.all.display.limits;
          s.controlSurfaces.displayCfg = r.all.display.cfg;
          s.controlSurfaces.displayPages = r.all.display.pages;
          s.controlSurfaces.displayStatus = r.all.display.status;
        }
      }
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.controlSurfaces.revertEpoch++;
      s.controlSurfaces.changed = { bindings: false, groups: false, macros: false, display: false };
      ok = true;
    },
  );
  return ok;
}

// V16 — Control Surfaces IR command apply (0x8D + status poll, sub-slot
// encoded as 0x80 | sub in last_slot). Same shape as applyCsBinding: the
// polled status and the slot's live command land in state on both branches,
// resolving true only when the device accepted the command.
export async function applyCsIrCommand(s: ReadySession, sub: number, cmd: Domain.CsIrCommand): Promise<boolean> {
  let ok = false;
  await command(s, 'set control-surface IR command',
    async () => {
      const r = await s.device.setCsIrCmd(sub, cmd);
      const live = await s.device.getCsIrCmd(sub);
      return { result: r.result, status: r.status, live };
    },
    (r, s) => {
      s.controlSurfaces.status = r.status;
      s.controlSurfaces.irCommands[sub] = r.live.protocol === Domain.CsIrProto.None ? null : r.live;
      if (!r.result.ok) { pushNotice('warn', r.result.message); return; }
      s.controlSurfaces.changed.bindings = true;
      ok = true;
    },
  );
  return ok;
}

export function clearCsIrCommand(s: ReadySession, sub: number): Promise<boolean> {
  return applyCsIrCommand(s, sub, Domain.EMPTY_CS_IR_COMMAND);
}

// V16 — arm the IR learn window (0x8F, wValue=1). Fails immediately (no
// status poll, no queued apply) with NO_IR when there is no live IR
// receiver; on success the sub-state moves to ARMED so the panel can show
// "listening" until the notify channel reports completion (see
// notifyChannel.ts's csIrLearn routing).
export async function csIrLearnArm(s: ReadySession): Promise<boolean> {
  // Drop any previous result synchronously, BEFORE the device round-trip:
  // the panel's completion effect runs during the await, and a stale
  // DONE/TIMEOUT would complete the new learn instantly with the old code.
  s.controlSurfaces.irLearn = null;
  let ok = false;
  await command(s, 'arm IR learn',
    () => s.device.csIrLearnArm(),
    (result, s) => {
      if (!result.ok) { pushNotice('warn', result.message); return; }
      s.controlSurfaces.irLearn = { state: Domain.CS_IR_LEARN_ARMED, protocol: Domain.CsIrProto.None, code: 0 };
      ok = true;
    },
  );
  return ok;
}

// V16 — cancel an armed IR learn (0x8F, wValue=0); pushes no notification,
// so the sub-state returns to idle locally rather than waiting on one.
export async function csIrLearnCancel(s: ReadySession): Promise<void> {
  await command(s, 'cancel IR learn',
    () => s.device.csIrLearnCancel(),
    (_result, s) => { s.controlSurfaces.irLearn = null; },
  );
}

import * as Wire from '../wireTypes';
import { PagedCmd } from '../paged.gen';
import type { ActionCommand, Command, RawCommand } from './types';

type CsBindingPayload = {
  type: number; noun: number; action: number; flags: number;
  gpio0: number; gpio1: number; event: number; target: number; index: number; baseBright: number;
  value: number; step: number; rangeMin: number; rangeMax: number;
  onDelay: number; offDelay: number; reserved2: number[];
};
type CsStatusPayload = {
  lastStatus: number; lastSlot: number; maxBindings: number; dirty: boolean;
  activeMask: number; slotStatus: number[];
  irActiveMask: number; irLearnState: number; irCmdStatus: number[];
};
type CsIrCommandPayload = {
  noun: number; action: number; flags: number; target: number; index: number;
  protocol: number; value: number; step: number; code: number;
};
type CsGroupPayload = { targetKind: number; memberMask: number; name: string };
type CsMacroStepPayload = {
  noun: number; action: number; flags: number; target: number; index: number;
  value: number; step: number; preDelay: number;
};
type CsMacroHeaderPayload = { name: string; stepCount: number };
type CsMacroPayload = { name: string; stepCount: number; steps: CsMacroStepPayload[] };
type CsExtStatusPayload = {
  maxGroups: number; maxMacros: number; maxMacroSteps: number;
  macroRunning: number; macroStep: number;
  groupStatus: number[]; macroStatus: number[];
};
type CsDisplayCfgPayload = {
  mode: number; homePage: number; dwell: number; overlayHold: number;
  brightness: number; flags: number; editTimeout: number;
};
type CsDisplayCfgResponsePayload = { maxPages: number; modelCount: number; cfg: CsDisplayCfgPayload };
type CsDisplayPagePayload = { noun: number; target: number; index: number; flags: number };
type CsDisplayStatusPayload = {
  initState: number; currentPage: number; flags: number; model: number; nakCount: number;
};

export const CsCmd = {
  // --- Control Surfaces (0x84-0x87, 0x8B-0x8C, 0x9D-0x9E) ---
  // CsBinding SET is a control-OUT (wValue = slot) with NO response: firmware
  // latches the binding and applies it from the main loop, so the outcome is
  // learned by polling CsStatus until last_status leaves PENDING (see
  // DspDevice.setCsBinding). CsCaps stays raw: wValue 0xFFFF returns the
  // capsVersion/typeCount-driven header + type table (parsed dynamically in
  // DspDevice), a noun index its 12-byte descriptor.
  CsBinding: { codec: Wire.CsBinding, legacy: { get: 0x85, set: 0x84 } } satisfies Command<CsBindingPayload>,
  CsCaps: { legacy: { get: 0x86 } } satisfies RawCommand,
  // The codec here is the current-firmware (caps v6+) 41-byte shape, used
  // generically by decodeOrSize in the wire monitor; a beta-era 32-byte
  // response there just zero-pads, cosmetic for a debug log line. The
  // functional read (both layouts) goes through DspDevice's own status
  // helper, which discriminates by response length.
  CsStatus: { codec: Wire.CsStatusPacketV6, legacy: { get: 0x87 } } satisfies Command<CsStatusPayload>,
  // Slot name SET/GET: same live-only-preview semantics as CsBinding,
  // polled the same way.
  CsName: { codec: Wire.CsName, legacy: { get: 0x8C, set: 0x8B } } satisfies Command<string>,
  // IR command sub-slots: same deferred SET model as CsBinding, reported
  // in last_slot as 0x80 | sub-slot. CsIrCmd is a plain live read.
  CsIrCmd: { codec: Wire.CsIrCommand, legacy: { get: 0x8E, set: 0x8D } } satisfies Command<CsIrCommandPayload>,

  // Target groups (caps v9+, 0x20/0x21) and macros (caps v9+, 0x22-0x25); ext
  // status is 0x26. Group/macro header/step SETs share CsBinding's
  // deferred-apply model: the outcome is polled via CsStatus, reported in
  // last_slot as 0x40 | group or 0x60 | macro. A macro step's wValue
  // additionally packs (step << 8) | macro; hosts must write steps first and
  // the header last (see DspDevice.setCsMacro).
  CsGroup: { codec: Wire.CsGroup, legacy: { get: 0x21, set: 0x20 } } satisfies Command<CsGroupPayload>,
  CsMacroHeader: { codec: Wire.CsMacroHeader, legacy: { set: 0x22 } } satisfies Command<CsMacroHeaderPayload>,
  CsMacro: { codec: Wire.CsMacro, legacy: { get: 0x23 } } satisfies Command<CsMacroPayload>,
  CsMacroStep: { codec: Wire.CsMacroStep, legacy: { set: 0x24 } } satisfies Command<CsMacroStepPayload>,
  CsExtStatus: { codec: Wire.CsExtStatusPacket, legacy: { get: 0x26 } } satisfies Command<CsExtStatusPayload>,

  // I2C displays (caps v10+, 0x27-0x2B). Cfg and page SETs are deferred,
  // reported through the same CsStatus channel as bindings/groups/macros:
  // cfg tagged slot 0x50, page N tagged slot 0x50 | N. wValue on the page
  // GET is compared against all 16 bits (>= 16 STALLs); the SET's wValue is
  // masked to the low byte like every other CS slot index.
  CsDisplayCfg: { codec: Wire.CsDisplayCfg, legacy: { set: 0x27 }, paged: { get: PagedCmd.CS.DISPLAY_CONFIG.id, set: PagedCmd.CS.DISPLAY_CONFIG.id } } satisfies Command<CsDisplayCfgPayload>,
  // Paged: the 4 limit bytes of the 1.1.6 reply are their own command.
  CsDisplayCaps: { codec: Wire.CsDisplayCaps, legacy: {}, paged: { get: PagedCmd.CS.DISPLAY_CAPS.id } } satisfies Command<{ maxPages: number; modelCount: number }>,
  CsDisplayCfgResponse: { codec: Wire.CsDisplayCfgResponse, legacy: { get: 0x28 } } satisfies Command<CsDisplayCfgResponsePayload>,
  CsDisplayPage: { codec: Wire.CsDisplayPage, legacy: { get: 0x2A, set: 0x29 } } satisfies Command<CsDisplayPagePayload>,
  CsDisplayStatus: { codec: Wire.CsDisplayStatus, legacy: { get: 0x2B } } satisfies Command<CsDisplayStatusPayload>,
} as const;

export const CsAct = {
  // GET-type action command (wValue 1 = arm, 0 = cancel, 2 = read result),
  // in the mold of CsSave/CsRevert. Arm/cancel return a 1-byte ack;
  // the result read returns the 8-byte CsIrLearnResult instead, so this
  // is not decoded here: DspDevice decodes each response shape itself.
  CsIrLearn: { legacy: { code: 0x8F } } satisfies ActionCommand,
  // Persist / discard the live CS preview (bindings + names). Action-style
  // IN: 1-byte accept/reject, real result via CsStatus (last_slot 0xFF).
  CsSave: { legacy: { code: 0x9D } } satisfies ActionCommand,
  CsRevert: { legacy: { code: 0x9E } } satisfies ActionCommand,
  // GET-style action (wValue = macro to fire, 0xFFFF cancels the running
  // macro), in the mold of CsSave/CsRevert: 1-byte ack, no status poll.
  CsMacroFire: { legacy: { code: 0x25 } } satisfies ActionCommand,
} as const;

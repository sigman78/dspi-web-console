// Paged-protocol (firmware 1.1.7+) request executor. A refused request STALLs
// and changes nothing; the reason is recorded in SYS.LAST_RESULT, which this
// module reads inside the same exclusive unit so no other request can
// overwrite it first.
//
// Only an explained refusal becomes a CommandRefused. A STALL that cannot be
// explained (explain: false, or a record that is not this request's) rethrows
// as-is, and any failure of the LAST_RESULT read propagates: on WinUSB every
// transfer error is a NetworkError, so only the record tells a refusal from a
// dead link.
//
// Chunked commands: the firmware keeps a chunk session open after a SETUP-time
// refusal, but reading LAST_RESULT is a new SETUP and closes it. After a
// CommandRefused on a chunk command the caller restarts at offset 0. BUSY only
// occurs at offset 0, so the BUSY resend is safe.

import { RefusedError, type DspTransport } from '@/transport/DspTransport';
import { pagedCommand } from './paged';
import { PagedCmd, VcResult } from './paged.gen';
import { isStall } from './protocolInfo';
import { StatusFamily, type LegacyStatusFamily, type VcByte } from './legacyMap.gen';
import { fmtCmdId } from './wireMonitor';

export type RefusalReason =
  | 'unknown' | 'direction' | 'length' | 'address' | 'value' | 'unsupported'
  | 'blocked' | 'busy' | 'state' | 'pinInvalid' | 'pinInUse';

const REASONS: Record<number, [RefusalReason, string]> = {
  [VcResult.VC_ERR_UNKNOWN]: ['unknown', 'the device does not know this command'],
  [VcResult.VC_ERR_DIRECTION]: ['direction', 'the command does not accept this transfer direction'],
  [VcResult.VC_ERR_LENGTH]: ['length', 'the payload length is outside the allowed range'],
  [VcResult.VC_ERR_ADDRESS]: ['address', 'the address is out of range'],
  [VcResult.VC_ERR_VALUE]: ['value', 'the value is not acceptable'],
  [VcResult.VC_ERR_UNSUPPORTED]: ['unsupported', 'this device does not support it'],
  [VcResult.VC_ERR_BLOCKED]: ['blocked', 'it is blocked right now'],
  [VcResult.VC_ERR_BUSY]: ['busy', 'the device stayed busy'],
  [VcResult.VC_ERR_STATE]: ['state', 'the device is in the wrong state for it'],
  [VcResult.VC_ERR_PIN_INVALID]: ['pinInvalid', 'the pin cannot be used for this function'],
  [VcResult.VC_ERR_PIN_IN_USE]: ['pinInUse', 'the pin is already in use'],
};

// The device STALLed a paged request and recorded `vc` (a VC_* code) as the reason.
export class CommandRefused extends RefusedError {
  readonly reason: RefusalReason;

  constructor(readonly cmd: number, readonly dir: 'get' | 'set', readonly vc: number) {
    const [reason, words] = REASONS[vc] ?? ['unknown', `result code ${vc}`];
    super(`${pagedCommand(cmd)?.name ?? fmtCmdId(cmd)} ${dir.toUpperCase()} refused: ${words}`);
    this.name = 'CommandRefused';
    this.reason = reason;
  }
}

const LAST_RESULT = PagedCmd.SYS.LAST_RESULT.id;

export interface LastResult {
  id: number;
  dir: 'get' | 'set';
  vc: number;
  wValue: number;
}

export function parseLastResult(bytes: Uint8Array): LastResult | null {
  if (bytes.length < 6) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { id: v.getUint16(0, true), dir: bytes[2] === 1 ? 'get' : 'set', vc: bytes[3], wValue: v.getUint16(4, true) };
}

export interface ExclusiveTransport {
  exclusive<T>(fn: (raw: DspTransport) => Promise<T>): Promise<T>;
}

export interface PagedOpts {
  // Read SYS.LAST_RESULT after a STALL to learn why (default true).
  explain?: boolean;
  // Resends after VC_ERR_BUSY (default 4, so 5 tries).
  busyRetries?: number;
  // Wait before a BUSY resend (default 0: the resend and the LAST_RESULT read already span USB frames, and timers throttle in hidden tabs).
  busyDelayMs?: number;
  // pagedAction only: refusal-code to status-byte pairs consulted ahead of the family table.
  statusOverrides?: readonly VcByte[];
}

function execute<T>(
  t: ExclusiveTransport, id: number, dir: 'get' | 'set', wValue: number, opts: PagedOpts,
  send: (raw: DspTransport) => Promise<T>,
): Promise<T> {
  const { explain = true, busyRetries = 4, busyDelayMs = 0 } = opts;
  return t.exclusive(async (raw) => {
    for (let retries = 0; ; retries++) {
      try {
        return await send(raw);
      } catch (err) {
        if (!isStall(err) || !explain) throw err;
        const rec = parseLastResult(await raw.ctrlIn(LAST_RESULT, 0, 8));
        if (!rec || rec.id !== id || rec.dir !== dir || rec.wValue !== wValue || rec.vc === VcResult.VC_OK) throw err;
        if (rec.vc === VcResult.VC_ERR_BUSY && retries < busyRetries) {
          if (busyDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, busyDelayMs));
          continue;
        }
        throw new CommandRefused(id, dir, rec.vc);
      }
    }
  });
}

export function pagedGet(t: ExclusiveTransport, id: number, wValue: number, length: number, opts: PagedOpts = {}): Promise<Uint8Array> {
  return execute(t, id, 'get', wValue, opts, (raw) => raw.ctrlIn(id, wValue, length));
}

export function pagedSet(t: ExclusiveTransport, id: number, wValue: number, data: Uint8Array, opts: PagedOpts = {}): Promise<void> {
  return execute(t, id, 'set', wValue, opts, (raw) => raw.ctrlOut(id, wValue, data));
}

// A 1.1.6 write-as-read action on paged firmware: the family status byte, the
// success byte or the byte the refusal maps to. An unmapped refusal rethrows.
export async function pagedAction(
  t: ExclusiveTransport, id: number, wValue: number, data: Uint8Array,
  family: LegacyStatusFamily, opts: PagedOpts = {},
): Promise<number> {
  const fam = StatusFamily[family];
  try {
    await pagedSet(t, id, wValue, data, opts);
    return fam.success;
  } catch (err) {
    if (err instanceof CommandRefused) {
      const hit = [...(opts.statusOverrides ?? []), ...fam.fromVc].find(([vc]) => vc === err.vc);
      if (hit) return hit[1];
    }
    throw err;
  }
}

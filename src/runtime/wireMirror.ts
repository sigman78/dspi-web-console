// Owns the spliced raw WireBulkParams buffer and produces before/after domain
// snapshots for a PARAM_CHANGED splice. Auto-reseeds from DspDevice.lastRawBulk by
// reference identity (a full read replaces that array, which we detect and adopt),
// so there are no explicit reseed call sites.
//
// The diff base is this buffer's own prior decode (prev), NOT mirror.current:
// granular user writes drift mirror.current from the raw buffer, so diffing the
// splice against the buffer isolates exactly the notified field(s).
//
// One instance per session: two devices splicing concurrently must not reseed
// each other.

import type { DspDevice } from '@/device/DspDevice';
import type { DspSnapshot } from '@/domain';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { parseBulkParams } from '@/protocol';

function decode(device: DspDevice, bytes: Uint8Array): DspSnapshot {
  return fromBulkParams(device.hardware, parseBulkParams(bytes));
}

export class WireMirror {
  #buf: Uint8Array | null = null;          // working copy; advances on each splice
  #seededFrom: Uint8Array | null = null;   // identity of the device read we seeded from

  splice(device: DspDevice, offset: number, value: Uint8Array): { prev: DspSnapshot; next: DspSnapshot } | null {
    const base = device.lastRawBulk;
    if (!base) return null;
    if (base !== this.#seededFrom) {               // a full read landed -> adopt it
      this.#buf = new Uint8Array(base);
      this.#seededFrom = base;
    }
    const buf = this.#buf as Uint8Array;
    if (offset < 0 || offset + value.length > buf.length) return null;
    const prev = decode(device, buf);
    const spliced = new Uint8Array(buf);
    spliced.set(value, offset);
    const next = decode(device, spliced);
    this.#buf = spliced;                            // commit: successive splices compound
    return { prev, next };
  }
}

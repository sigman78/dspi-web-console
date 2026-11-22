import * as Translate from '@/protocol/legacyTranslate';
import type { DspTransport, TransportEvent } from './DspTransport';
import type { GuardedDspTransport } from './withGenerationGuard';

// Decorator: on a paged connection, answers the console's 1.1.6 requests
// (opcode <= 0xFF) by running their paged equivalents on `inner`. Paged IDs
// (the probe, the handshake, the executor's own reads) and every request on a
// legacy connection pass through unchanged.
//
// Stack it between the serializer and the guard so one legacy call, with its
// LAST_RESULT read and BUSY resends, occupies a single serialized slot:
// withSerializedCtrl(withLegacyTranslation(withGenerationGuard(transport))).
export function withLegacyTranslation(inner: GuardedDspTransport): DspTransport {
  const translated = Translate.translatingTransport(inner);
  const viaPaged = (cmd: number): boolean => inner.generation === 'paged' && cmd <= 0xFF;
  return {
    open: () => inner.open(),
    close: () => inner.close(),
    isOpen: () => inner.isOpen(),
    on: (event: TransportEvent, listener: () => void) => inner.on(event, listener),
    ctrlIn: (cmd, value, length) => viaPaged(cmd) ? translated.ctrlIn(cmd, value, length) : inner.ctrlIn(cmd, value, length),
    ctrlOut: (cmd, value, data) => viaPaged(cmd) ? translated.ctrlOut(cmd, value, data) : inner.ctrlOut(cmd, value, data),
    ...(inner.notifyIn
      ? { notifyIn: (length: number) => inner.notifyIn!(length) }
      : {}),
  };
}

import { Log } from '@/utils';
import * as WireMon from '@/protocol/wireMonitor';
import type { DspTransport, TransportEvent } from './DspTransport';

// Decorator: wraps a DspTransport so every ctrlIn/ctrlOut/notifyIn is logged
// to the console at info level once the call settles. Sits INSIDE the timeout
// decorator (closest to the metal) so it sees the real bytes and response and
// its formatting cost is off the timeout-race path. Logging is fully guarded:
// a formatter or Log failure can never break or delay a transfer. open/close/
// isOpen/on pass through; notifyIn is forwarded only when the inner exposes it.
export function withWireMonitor(inner: DspTransport): DspTransport {
  // Logging must never break a transfer — swallow any console/Log failure.
  const warn = (...args: unknown[]): void => {
    try { Log.warn('wire', ...args); } catch { /* ignore */ }
  };

  const emit = (build: () => string | null): void => {
    try {
      const line = build();
      if (line) Log.info('wire', line);
    } catch (err) {
      warn('monitor formatter threw', err);
    }
  };

  return {
    open: () => inner.open(),
    close: () => inner.close(),
    isOpen: () => inner.isOpen(),
    on: (event: TransportEvent, listener: () => void) => inner.on(event, listener),

    async ctrlIn(request, value, length) {
      try {
        const bytes = await inner.ctrlIn(request, value, length);
        emit(() => WireMon.formatCtrlIn(request, value, bytes));
        return bytes;
      } catch (err) {
        warn(`✗ ctrlIn 0x${request.toString(16)}`, err);
        throw err;
      }
    },

    async ctrlOut(request, value, data) {
      try {
        await inner.ctrlOut(request, value, data);
        emit(() => WireMon.formatCtrlOut(request, value, data));
      } catch (err) {
        warn(`✗ ctrlOut 0x${request.toString(16)}`, err);
        throw err;
      }
    },

    ...(inner.notifyIn
      ? {
          async notifyIn(length: number) {
            const bytes = await inner.notifyIn!(length);
            emit(() => WireMon.formatNotify(bytes));
            return bytes;
          },
        }
      : {}),
  };
}

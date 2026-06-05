import { Log } from '@/utils';
import * as WireMon from '@/protocol/wireMonitor';
import type { DspTransport, TransportEvent } from './DspTransport';

// Decorator: log every settled ctrlIn/ctrlOut/notifyIn. Sits INSIDE the timeout
// decorator so it sees the real bytes and its formatting cost is off the
// timeout-race path. Logging is fully guarded: a formatter or Log failure can
// never break or delay a transfer.
export function withWireMonitor(inner: DspTransport): DspTransport {
  const warn = (...args: unknown[]): void => {
    try { Log.warn('wire', ...args); } catch { /* ignore */ }
  };

  // Telemetry polls go to debug (hidden by default), everything else to info.
  const emit = (level: 'info' | 'debug', build: () => string | null): void => {
    try {
      const line = build();
      if (line) Log[level]('wire', line);
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
        const level = WireMon.isPollCommand(request) ? 'debug' : 'info';
        emit(level, () => WireMon.formatCtrlIn(request, value, bytes));
        return bytes;
      } catch (err) {
        warn(`x ctrlIn 0x${request.toString(16)}`, err);
        throw err;
      }
    },

    async ctrlOut(request, value, data) {
      try {
        await inner.ctrlOut(request, value, data);
        emit('info', () => WireMon.formatCtrlOut(request, value, data));
      } catch (err) {
        warn(`x ctrlOut 0x${request.toString(16)}`, err);
        throw err;
      }
    },

    ...(inner.notifyIn
      ? {
          async notifyIn(length: number) {
            const bytes = await inner.notifyIn!(length);
            emit('info', () => WireMon.formatNotify(bytes));
            return bytes;
          },
        }
      : {}),
  };
}

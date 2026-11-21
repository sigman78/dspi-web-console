import { Log } from '@/utils';
import * as WireMon from '@/protocol/wireMonitor';
import { PAGED_PROTOCOL_INFO, isLegacyProbeRefusal } from '@/protocol/protocolInfo';
import { type DspTransport, type TransportEvent } from './DspTransport';

// Decorator: log every settled ctrlIn/ctrlOut/notifyIn. Sits INSIDE the timeout
// decorator so it sees the real bytes and its formatting cost is off the
// timeout-race path. Logging is fully guarded: a formatter or Log failure can
// never break or delay a transfer.
export function withWireMonitor(inner: DspTransport): DspTransport {
  // Last-seen bulk wire version, learned from GetAllParams/SetAllParams (or a
  // chunk-0 GetAllParamsChunk/SetAllParamsChunk); lets a later PARAM_CHANGED
  // notify be decoded against the right section layout.
  let lastBulkVersion: number | null = null;

  const warn = (...args: unknown[]): void => {
    try {
      Log.warn('wire', ...args);
      WireMon.recordWireLine(`! ${args.map(String).join(' ')}`);
    } catch { /* ignore */ }
  };

  // Telemetry polls go to debug (hidden by default), everything else to info.
  // Only info-level lines are captured -- debug-level polls would flood the
  // rolling capture window.
  const emit = (level: 'info' | 'debug', build: () => string | null): void => {
    try {
      const line = build();
      if (line) {
        Log[level]('wire', line);
        if (level === 'info') WireMon.recordWireLine(line);
      }
    } catch (err) {
      warn('monitor formatter threw', err);
    }
  };

  return {
    open: () => inner.open(),
    close: () => inner.close(),
    isOpen: () => inner.isOpen(),
    on: (event: TransportEvent, listener: () => void) => inner.on(event, listener),

    async ctrlIn(cmd, value, length) {
      try {
        const bytes = await inner.ctrlIn(cmd, value, length);
        const version = WireMon.bulkVersionFromTraffic(cmd, value, bytes);
        if (version !== null) lastBulkVersion = version;
        const level = WireMon.isPollCommand(cmd) ? 'debug' : 'info';
        emit(level, () => WireMon.formatCtrlIn(cmd, value, bytes));
        return bytes;
      } catch (err) {
        // A legacy device STALLs the connect probe by design.
        if (cmd === PAGED_PROTOCOL_INFO && isLegacyProbeRefusal(err)) {
          emit('info', () => `<- ${WireMon.fmtCmdId(cmd)} PROTOCOL_INFO probe stalled (legacy firmware)`);
        } else {
          warn(`x ctrlIn ${WireMon.fmtCmdId(cmd)}`, err);
        }
        throw err;
      }
    },

    async ctrlOut(cmd, value, data) {
      try {
        await inner.ctrlOut(cmd, value, data);
        const version = WireMon.bulkVersionFromTraffic(cmd, value, data);
        if (version !== null) lastBulkVersion = version;
        emit('info', () => WireMon.formatCtrlOut(cmd, value, data));
      } catch (err) {
        warn(`x ctrlOut ${WireMon.fmtCmdId(cmd)}`, err);
        throw err;
      }
    },

    ...(inner.notifyIn
      ? {
          async notifyIn(length: number) {
            const bytes = await inner.notifyIn!(length);
            emit('info', () => WireMon.formatNotify(bytes, lastBulkVersion));
            return bytes;
          },
        }
      : {}),
  };
}

import { fmtCmdId } from '@/protocol/wireMonitor';
import { PAGED_PROTOCOL_INFO } from '@/protocol/protocolInfo';
import { hasPaged } from '@/protocol/paged';
import { RefusedError, type DspTransport, type TransportEvent } from './DspTransport';

// Legacy firmware (1.1.6 and older) speaks page 0 and ignores the page byte;
// paged firmware (1.1.7+) refuses page 0.
export type ProtocolGeneration = 'legacy' | 'paged';

// The console tried a command the connected generation does not speak. Thrown
// before anything reaches the wire, so it is a console bug, not a link fault.
export class GenerationRefusal extends RefusedError {
  constructor(readonly cmd: number, readonly generation: ProtocolGeneration | null) {
    super(generation === null
      ? `${fmtCmdId(cmd)} refused: only the protocol probe may run before the protocol generation is known`
      : generation === 'legacy'
        ? `${fmtCmdId(cmd)} refused: legacy firmware speaks page 0 only`
        : `${fmtCmdId(cmd)} refused: not a paged command in this direction`);
    this.name = 'GenerationRefusal';
  }
}

export interface GuardedDspTransport extends DspTransport {
  // Once per connection, from the connect probe.
  setGeneration(gen: ProtocolGeneration): void;
}

// A page-0 ID sent to legacy firmware runs that opcode; any other page would
// run its low byte as an unrelated legacy opcode. Paged firmware STALLs page 0,
// and every paged command has a fixed direction in the registry.
function allowed(gen: ProtocolGeneration | null, cmd: number, dir: 'in' | 'out'): boolean {
  if (gen === null) return dir === 'in' && cmd === PAGED_PROTOCOL_INFO;
  return gen === 'legacy' ? cmd <= 0xFF : hasPaged(cmd, dir);
}

// Decorator: refuses every control transfer the connected protocol generation
// does not speak. Until the connect probe sets the generation, the probe is
// the only request allowed through.
export function withGenerationGuard(inner: DspTransport): GuardedDspTransport {
  let generation: ProtocolGeneration | null = null;

  const check = (cmd: number, dir: 'in' | 'out'): void => {
    if (!allowed(generation, cmd, dir)) throw new GenerationRefusal(cmd, generation);
  };

  return {
    setGeneration(gen) {
      if (generation !== null) throw new Error(`protocol generation already set to ${generation}`);
      generation = gen;
    },
    open: () => inner.open(),
    close: () => inner.close(),
    isOpen: () => inner.isOpen(),
    on: (event: TransportEvent, listener: () => void) => inner.on(event, listener),
    async ctrlIn(cmd, value, length) {
      check(cmd, 'in');
      return inner.ctrlIn(cmd, value, length);
    },
    async ctrlOut(cmd, value, data) {
      check(cmd, 'out');
      return inner.ctrlOut(cmd, value, data);
    },
    ...(inner.notifyIn
      ? { notifyIn: (length: number) => inner.notifyIn!(length) }
      : {}),
  };
}

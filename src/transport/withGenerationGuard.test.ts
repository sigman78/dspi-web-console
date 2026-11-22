import { describe, it, expect, vi } from 'vitest';
import { PAGED_PROTOCOL_INFO } from '@/protocol/protocolInfo';
import type { DspTransport } from './DspTransport';
import { withGenerationGuard, GenerationRefusal } from './withGenerationGuard';

const GET_STATUS = 0x50;
const PAGED_SET = 0x0230;

function spy() {
  const inner: DspTransport = {
    open: async () => {},
    close: async () => {},
    isOpen: () => true,
    on: () => () => {},
    ctrlIn: vi.fn(async () => new Uint8Array(1)),
    ctrlOut: vi.fn(async () => {}),
  };
  return { inner, guard: withGenerationGuard(inner) };
}

describe('withGenerationGuard', () => {
  it('lets only the probe IN through before the generation is known', async () => {
    const { inner, guard } = spy();
    await guard.ctrlIn(PAGED_PROTOCOL_INFO, 0, 16);
    await expect(guard.ctrlIn(GET_STATUS, 0, 4)).rejects.toBeInstanceOf(GenerationRefusal);
    await expect(guard.ctrlOut(PAGED_PROTOCOL_INFO, 0, new Uint8Array(1))).rejects.toBeInstanceOf(GenerationRefusal);
    expect(inner.ctrlIn).toHaveBeenCalledTimes(1);
    expect(inner.ctrlOut).not.toHaveBeenCalled();
  });

  it('on legacy firmware passes page 0 and refuses other pages before the wire', async () => {
    const { inner, guard } = spy();
    guard.setGeneration('legacy');
    await guard.ctrlIn(GET_STATUS, 0, 4);
    await guard.ctrlOut(0xFF, 0, new Uint8Array(1));
    await expect(guard.ctrlIn(PAGED_PROTOCOL_INFO, 0, 16)).rejects.toBeInstanceOf(GenerationRefusal);
    await expect(guard.ctrlOut(PAGED_SET, 0, new Uint8Array(1))).rejects.toBeInstanceOf(GenerationRefusal);
    expect(inner.ctrlIn).toHaveBeenCalledTimes(1);
    expect(inner.ctrlOut).toHaveBeenCalledTimes(1);
  });

  it('sets the generation once per connection', () => {
    const { guard } = spy();
    guard.setGeneration('legacy');
    expect(() => guard.setGeneration('paged')).toThrow();
  });

  it('on paged firmware refuses page 0', async () => {
    const { inner, guard } = spy();
    guard.setGeneration('paged');
    await guard.ctrlOut(PAGED_SET, 0, new Uint8Array(1));
    await expect(guard.ctrlIn(GET_STATUS, 0, 4)).rejects.toBeInstanceOf(GenerationRefusal);
    expect(inner.ctrlIn).not.toHaveBeenCalled();
    expect(inner.ctrlOut).toHaveBeenCalledTimes(1);
  });
});

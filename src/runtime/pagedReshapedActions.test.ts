import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { bootMock } from './boot';
import * as EqActions from './eqActions';
import * as IoActions from './ioActions';
import * as State from '@/state';
import * as Domain from '@/domain';
import { resolveMockProfile } from '@/mockProfiles';

async function boot(): Promise<State.ReadySession> {
  const profile = resolveMockProfile('v34', 'rp2350');
  await bootMock(profile.platform, profile.opts);
  return State.activeSession()!;
}

beforeEach(() => { State.resetAppState(); State.clearNotices(); });
afterEach(() => { State.activeSession()?.dispose(); State.resetAppState(); vi.restoreAllMocks(); });

const band = (type: Domain.FilterType): Domain.FilterParams => ({ type, bypass: false, frequency: 800, q: 1, gain: 2 });

describe('band writes carry the target band bypass', () => {
  it('setEqFilter sends the mirror bypass, not the caller\'s', async () => {
    const s = await boot();
    s.mirror.snapshot.channels.find((c) => c.id === Domain.ChannelId.Out1L)!.filters[2].bypass = true;
    const send = vi.spyOn(s.device, 'setFilter');
    EqActions.setEqFilter(s, Domain.ChannelId.Out1L, 2, band(Domain.FilterType.Peaking));
    await s.writes.flush();
    expect(send.mock.calls[0][2].bypass).toBe(true);
  });

  it('copyEqBands sends each target band\'s own bypass, not the source\'s', async () => {
    const s = await boot();
    const src = s.mirror.snapshot.channels.find((c) => c.id === Domain.ChannelId.Out1L)!;
    const tgt = s.mirror.snapshot.channels.find((c) => c.id === Domain.ChannelId.Out2L)!;
    src.filters.forEach((f) => { f.bypass = false; });
    tgt.filters.forEach((f, i) => { f.bypass = i === 4; });
    const send = vi.spyOn(s.device, 'setFilter');
    EqActions.copyEqBands(s, Domain.ChannelId.Out1L, Domain.ChannelId.Out2L);
    await s.writes.flush();
    const sent = send.mock.calls.map((c) => [c[1], c[2].bypass]);
    expect(sent).toHaveLength(src.filters.length);
    for (const [bandIndex, bypass] of sent) expect(bypass).toBe(bandIndex === 4);
  });

  it('setXoverBand sends the crossover band\'s mirror bypass', async () => {
    const s = await boot();
    s.mirror.snapshot.channels.find((c) => c.id === Domain.ChannelId.Out1L)!.xoverBands![1].bypass = true;
    const send = vi.spyOn(s.device, 'setCrossoverBand');
    EqActions.setXoverBand(s, Domain.ChannelId.Out1L, 1, band(Domain.XOVER_TYPE_FIRST));
    await s.writes.flush();
    expect(send.mock.calls[0][2].bypass).toBe(true);
  });
});

describe('S/PDIF input toggles on a paged device', () => {
  it('follow the block: enabling input 3 turns on input 2, disabling input 2 drops input 3', async () => {
    const s = await boot();
    const reconcile = vi.spyOn(s.mirror, 'requestReconcile');
    expect(await IoActions.setSpdifInputEnabled(s, 1, true)).toBe(true);
    expect(s.mirror.snapshot.inputConfig.spdifExtEnabled.slice(0, 2)).toEqual([true, true]);
    expect(reconcile).toHaveBeenCalledWith(true);
    expect(await IoActions.setSpdifInputEnabled(s, 0, false)).toBe(true);
    expect(s.mirror.snapshot.inputConfig.spdifExtEnabled.slice(0, 2)).toEqual([false, false]);
    expect((await s.device.getSpdifInputConfig()).enableMask).toBe(1);
  });
});

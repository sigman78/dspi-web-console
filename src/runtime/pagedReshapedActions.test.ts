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

describe('input blocks on a paged device', () => {
  it('the count and the S/PDIF switch land in the mirror and the device', async () => {
    const s = await boot();
    expect(await IoActions.setSpdifInputCount(s, 3)).toBe(true);
    expect(s.mirror.snapshot.inputConfig.spdifCount).toBe(3);
    expect((await s.device.getSpdifInputConfig()).enableMask).toBe(0b0111);

    s.telemetry.spdifRxStatus = { state: 2 } as never;
    expect(await IoActions.setSpdifBlockEnabled(s, false)).toBe(true);
    expect(s.mirror.snapshot.inputConfig.spdifEnabled).toBe(false);
    expect(s.telemetry.spdifRxStatus).toBeNull();
    expect((await s.device.getSpdifInputConfig()).enableMask).toBe(0);
  });

  it('a refused switch leaves the mirror alone', async () => {
    const s = await boot();
    expect(await IoActions.setI2sInputEnabled(s, true)).toBe(true);
    expect(s.mirror.snapshot.inputConfig.i2sEnabled).toBe(true);
    expect(await IoActions.setInputSource(s, Domain.AudioInputSource.I2s)).toBe(true);
    expect(await IoActions.setI2sInputEnabled(s, false)).toBe(false);
    expect(s.mirror.snapshot.inputConfig.i2sEnabled).toBe(true);
  });
});

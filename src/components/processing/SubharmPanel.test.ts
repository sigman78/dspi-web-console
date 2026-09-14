import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { ChannelId } from '@/domain';

const setSubharmEnabled = vi.fn();
const setSubharmLow = vi.fn();
const setSubharmHigh = vi.fn();
const setSubharmBoost = vi.fn();
const toggleSubharmOutputChannel = vi.fn();
const reserveSubharmHeadroom = vi.fn();

vi.mock('@/runtime', () => ({
  setSubharmEnabled: (...a: unknown[]) => setSubharmEnabled(...a),
  setSubharmLow: (...a: unknown[]) => setSubharmLow(...a),
  setSubharmHigh: (...a: unknown[]) => setSubharmHigh(...a),
  setSubharmBoost: (...a: unknown[]) => setSubharmBoost(...a),
  toggleSubharmOutputChannel: (...a: unknown[]) => toggleSubharmOutputChannel(...a),
  reserveSubharmHeadroom: (...a: unknown[]) => reserveSubharmHeadroom(...a),
}));

import SubharmPanel from './SubharmPanel.svelte';

// 8 output channels + PDM, RP2350-shaped (9 total, 4 stereo pairs) -- same
// fixture shape as PsybassPanel's, so the shared mask row behaves the same.
const OUTPUT_IDS = [
  ChannelId.Out1L, ChannelId.Out1R, ChannelId.Out2L, ChannelId.Out2R,
  ChannelId.Out3L, ChannelId.Out3R, ChannelId.Out4L, ChannelId.Out4R,
  ChannelId.Pdm,
];

function makeSession(o: {
  subharmEnabled?: boolean;
  lowDb?: number;
  headroomDb?: number | null;
  inputPreampDb?: number[];
  routes?: Array<{ inputIndex: number; outputWireIndex: number; enabled: boolean }>;
} = {}) {
  const channels = OUTPUT_IDS.map((id, i) => ({
    id, name: `Out ${i + 1}`, defaultName: `Out ${i + 1}`, shortName: `O${i + 1}`,
    bandCount: 12, isOutput: true, filters: [], xoverBands: [],
  }));
  const outputs = OUTPUT_IDS.map((id, i) => ({
    id, wireIndex: i, shortName: `O${i + 1}`, enabled: true, muted: false, gainDb: 0, delayMs: 0,
  }));
  return {
    device: { capabilities: { features: { subharm: true } } },
    telemetry: { subharmHeadroomDb: o.headroomDb ?? null },
    mirror: {
      current: {
        channels,
        outputs,
        routes: o.routes ?? [],
        inputPreampDb: o.inputPreampDb ?? [0, 0],
        subharm: {
          enabled: o.subharmEnabled ?? true,
          outputMask: 0xFFFF,
          lowDb: o.lowDb ?? -6,
          highDb: -6,
          boostDb: 0,
        },
      },
    },
  } as unknown;
}

function renderPanel(session: unknown) {
  return render(SubharmPanel, { context: new Map([[SESSION_KEY, session]]) });
}

describe('SubharmPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('toggling the header switch calls setSubharmEnabled(s, false) from an enabled state', async () => {
    renderPanel(makeSession({ subharmEnabled: true }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Disable subharm' }));
    expect(setSubharmEnabled).toHaveBeenCalledWith(expect.anything(), false);
  });

  test('dragging the low band slider calls setSubharmLow with the value', async () => {
    renderPanel(makeSession({}));
    const slider = screen.getByRole('slider', { name: 'Subharmonic 24 to 36 hertz band level' });
    await fireEvent.input(slider, { target: { value: '-12' } });
    expect(setSubharmLow).toHaveBeenCalledWith(expect.anything(), -12);
  });

  test('the low band value field shows "Off" at the floor', () => {
    renderPanel(makeSession({ lowDb: -30 }));
    expect(screen.getByText('Off')).toBeTruthy();
  });

  test('RESERVE is disabled when headroom is 0', () => {
    renderPanel(makeSession({ headroomDb: 0 }));
    expect(screen.getByRole('button', { name: 'Lower input preamps to reserve the subharmonic headroom' })).toBeDisabled();
  });

  test('shows "—" for a non-finite headroom reading, same as not-read-yet', () => {
    renderPanel(makeSession({ headroomDb: NaN }));
    expect(screen.getByText('—')).toBeTruthy();
  });

  test('RESERVE is enabled and calls reserveSubharmHeadroom when headroom > 0 and an input is above the line', async () => {
    // Input 0 feeds output slot 0 (enabled, and covered by the default
    // 0xFFFF mask) -- subharmReservePlan only reserves feeding inputs.
    renderPanel(makeSession({
      headroomDb: 4.2, inputPreampDb: [0, -6],
      routes: [{ inputIndex: 0, outputWireIndex: 0, enabled: true }],
    }));
    const button = screen.getByRole('button', { name: 'Lower input preamps to reserve the subharmonic headroom' });
    expect(button).not.toBeDisabled();
    await fireEvent.click(button);
    expect(reserveSubharmHeadroom).toHaveBeenCalledWith(expect.anything());
  });

  test('shows RESERVED text instead of the button when nothing is left to lower', () => {
    renderPanel(makeSession({
      headroomDb: 4.2, inputPreampDb: [-10, -10],
      routes: [{ inputIndex: 0, outputWireIndex: 0, enabled: true }],
    }));
    expect(screen.getByText('RESERVED')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lower input preamps to reserve the subharmonic headroom' })).toBeNull();
  });
});

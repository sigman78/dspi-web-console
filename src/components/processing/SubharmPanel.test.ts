import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { ChannelId } from '@/domain';
import { StatusStore } from '@/state/telemetry.svelte';

const setSubharmEnabled = vi.fn();
const setSubharmLow = vi.fn();
const setSubharmHigh = vi.fn();
const setSubharmBoost = vi.fn();
const toggleSubharmOutputChannel = vi.fn();
const reserveSubharmHeadroom = vi.fn();
const setSubharmTop = vi.fn();
const setSubharmSelectMode = vi.fn();
const setSubharmDepth = vi.fn();
const setSubharmHold = vi.fn();
const setSubharmCeiling = vi.fn();
const setSubharmLinkPairs = vi.fn();
const setSubharmSolo = vi.fn();
const fetchSubharmSolo = vi.fn();

vi.mock('@/runtime', () => ({
  setSubharmEnabled: (...a: unknown[]) => setSubharmEnabled(...a),
  setSubharmLow: (...a: unknown[]) => setSubharmLow(...a),
  setSubharmHigh: (...a: unknown[]) => setSubharmHigh(...a),
  setSubharmBoost: (...a: unknown[]) => setSubharmBoost(...a),
  toggleSubharmOutputChannel: (...a: unknown[]) => toggleSubharmOutputChannel(...a),
  reserveSubharmHeadroom: (...a: unknown[]) => reserveSubharmHeadroom(...a),
  setSubharmTop: (...a: unknown[]) => setSubharmTop(...a),
  setSubharmSelectMode: (...a: unknown[]) => setSubharmSelectMode(...a),
  setSubharmDepth: (...a: unknown[]) => setSubharmDepth(...a),
  setSubharmHold: (...a: unknown[]) => setSubharmHold(...a),
  setSubharmCeiling: (...a: unknown[]) => setSubharmCeiling(...a),
  setSubharmLinkPairs: (...a: unknown[]) => setSubharmLinkPairs(...a),
  setSubharmSolo: (...a: unknown[]) => setSubharmSolo(...a),
  fetchSubharmSolo: (...a: unknown[]) => fetchSubharmSolo(...a),
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
  subharmExt?: boolean;
  selectMode?: number;
  outputMask?: number;
  solo?: boolean;
  meter?: number[] | null;
} = {}) {
  const channels = OUTPUT_IDS.map((id, i) => ({
    id, name: `Out ${i + 1}`, defaultName: `Out ${i + 1}`, shortName: `O${i + 1}`,
    bandCount: 12, isOutput: true, filters: [], xoverBands: [],
  }));
  const outputs = OUTPUT_IDS.map((id, i) => ({
    id, wireIndex: i, shortName: `O${i + 1}`, enabled: true, muted: false, gainDb: 0, delayMs: 0,
  }));
  return {
    device: { capabilities: { features: { subharm: true, subharmExt: o.subharmExt ?? true } } },
    telemetry: {
      subharmHeadroomDb: o.headroomDb ?? null,
      subharmSolo: o.solo ?? false,
      subharmMeter: o.meter ?? null,
      wantSubharmMeter: vi.fn(() => vi.fn()),
    },
    mirror: {
      current: {
        channels,
        outputs,
        routes: o.routes ?? [],
        inputPreampDb: o.inputPreampDb ?? [0, 0],
        subharm: {
          enabled: o.subharmEnabled ?? true,
          outputMask: o.outputMask ?? 0xFFFF,
          lowDb: o.lowDb ?? -6,
          highDb: -6,
          boostDb: 0,
          topDb: -30,
          selectMode: o.selectMode ?? 0,
          selectDepth: 100,
          selectHoldMs: 150,
          ceilingDb: 0,
          linkPairs: true,
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

  test('mounting holds one unit of meter interest on the real store and releases it on unmount', () => {
    const telemetry = new StatusStore();
    telemetry.subharmMeter = [0.5];
    const session = makeSession({}) as { telemetry: unknown };
    session.telemetry = telemetry;
    const { unmount } = renderPanel(session);
    expect(telemetry.subharmMeterWanted).toBe(1);
    unmount();
    expect(telemetry.subharmMeterWanted).toBe(0);
    expect(telemetry.subharmMeter).toBeNull();
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
    // ext off so the ceiling slider (also labelled "Off" at its own extreme,
    // by default) doesn't render alongside it.
    renderPanel(makeSession({ lowDb: -30, subharmExt: false }));
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

  test('with subharmExt false, none of the V30 controls render', () => {
    renderPanel(makeSession({ subharmExt: false }));
    expect(screen.queryByRole('slider', { name: 'Subharmonic 56 to 80 hertz band level' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Subharmonic selectivity mode' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Subharmonic sub ceiling' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Link subharm pairs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Monitor the synthesized sub only' })).toBeNull();
  });

  test('DEPTH and HOLD are disabled while mode is All', () => {
    renderPanel(makeSession({ selectMode: 0 }));
    expect(screen.getByRole('slider', { name: 'Subharmonic selectivity depth' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Subharmonic selectivity hold time' })).toBeDisabled();
  });

  test('DEPTH and HOLD are enabled once mode is Percussive', () => {
    renderPanel(makeSession({ selectMode: 1 }));
    expect(screen.getByRole('slider', { name: 'Subharmonic selectivity depth' })).not.toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Subharmonic selectivity hold time' })).not.toBeDisabled();
  });

  test('clicking SOLO calls setSubharmSolo(s, true) from an off state', async () => {
    renderPanel(makeSession({ solo: false }));
    await fireEvent.click(screen.getByRole('button', { name: 'Monitor the synthesized sub only' }));
    expect(setSubharmSolo).toHaveBeenCalledWith(expect.anything(), true);
  });

  test('meter bars: excluding one output from the mask renders one bar fewer than the output count', () => {
    const { container } = renderPanel(makeSession({
      meter: Array(OUTPUT_IDS.length).fill(0.5),
      outputMask: 0xFFFF & ~1,   // exclude output slot 0
    }));
    expect(container.querySelectorAll('.bar')).toHaveLength(OUTPUT_IDS.length - 1);
  });
});

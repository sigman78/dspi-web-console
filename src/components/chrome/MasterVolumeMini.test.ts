import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { DspDevice } from '@/device/DspDevice';
import MasterVolumeMini from './MasterVolumeMini.svelte';

const setMasterVolume = vi.fn();
const setUserVolume = vi.fn();
const toggleMute = vi.fn();
const saveMasterVolumeBaseline = vi.fn();

vi.mock('@/runtime', () => ({
  setMasterVolume: (...a: unknown[]) => setMasterVolume(...a),
  setUserVolume: (...a: unknown[]) => setUserVolume(...a),
  toggleMute: (...a: unknown[]) => toggleMute(...a),
  saveMasterVolumeBaseline: (...a: unknown[]) => saveMasterVolumeBaseline(...a),
}));

import { dispatch, mintConnId, resetAppState, makeReadySession, settings } from '@/state';
import { masterDbToPos, MASTER_VOLUME_MAX_POS } from './masterVolumeTaper';

const USER_AXIS_TOGGLE = 'Volume axis: user volume. Switch to master volume.';
const MASTER_AXIS_TOGGLE = 'Volume axis: master volume. Switch to user volume.';

function synced(masterVolumeDb: number, userVolumeDb: number) {
  const id = mintConnId();
  const device = { info: { serial: 'AAA' }, hardware: { name: 'RP2350' } } as unknown as DspDevice;
  const session = makeReadySession(device);
  session.mirror.current = {
    masterVolumeDb,
    userVolume: { volumeDb: userVolumeDb, mute: false },
  } as unknown as typeof session.mirror.current;
  dispatch({ t: 'synced', id, session });
  return session;
}

beforeEach(() => {
  resetAppState();
  settings.volumeAxis = 'user';
  vi.clearAllMocks();
});

describe('MasterVolumeMini — dual-axis volume', () => {
  test('defaults to USER axis and the slider drives setUserVolume, not setMasterVolume', async () => {
    synced(-10, -20);
    render(MasterVolumeMini);

    const slider = screen.getByRole('slider', { name: 'User volume' }) as HTMLInputElement;
    expect(slider.value).toBe('-20');

    await fireEvent.input(slider, { target: { value: '-15' } });
    expect(setUserVolume).toHaveBeenCalledWith(expect.anything(), -15);
    expect(setMasterVolume).not.toHaveBeenCalled();
  });

  test('clicking the axis toggle switches to MASTER: slider carries the taper position for masterVolumeDb and drives setMasterVolume in dB', async () => {
    synced(-10, -20);
    render(MasterVolumeMini);

    await fireEvent.click(screen.getByRole('button', { name: USER_AXIS_TOGGLE }));

    // The slider now carries a taper index, not the raw dB value.
    const slider = screen.getByRole('slider', { name: 'Master volume' }) as HTMLInputElement;
    expect(slider.value).toBe(String(masterDbToPos(-10)));
    expect(slider.getAttribute('aria-valuetext')).toBe('-10.0');

    await fireEvent.input(slider, { target: { value: String(masterDbToPos(-5)) } });
    expect(setMasterVolume).toHaveBeenCalledWith(expect.anything(), -5);
    expect(setUserVolume).not.toHaveBeenCalled();
  });

  test('MASTER mode: dragging the slider to position 0 sends the -128 mute sentinel', async () => {
    synced(-10, -20);
    render(MasterVolumeMini);

    await fireEvent.click(screen.getByRole('button', { name: USER_AXIS_TOGGLE }));
    const slider = screen.getByRole('slider', { name: 'Master volume' }) as HTMLInputElement;

    await fireEvent.input(slider, { target: { value: '0' } });
    expect(setMasterVolume).toHaveBeenCalledWith(expect.anything(), -128);
  });

  test('MASTER mode: masterVolumeDb at the mute sentinel renders the slider at position 0 with the infinity glyph', async () => {
    synced(-128, -20);
    render(MasterVolumeMini);
    await fireEvent.click(screen.getByRole('button', { name: USER_AXIS_TOGGLE }));

    const slider = screen.getByRole('slider', { name: 'Master volume' }) as HTMLInputElement;
    expect(slider.value).toBe('0');
    expect(screen.getByText('−∞')).toBeInTheDocument();
  });

  test('MASTER mode: top slider position maps to unity (0 dB)', async () => {
    synced(-10, -20);
    render(MasterVolumeMini);

    await fireEvent.click(screen.getByRole('button', { name: USER_AXIS_TOGGLE }));
    const slider = screen.getByRole('slider', { name: 'Master volume' }) as HTMLInputElement;
    expect(slider.max).toBe(String(MASTER_VOLUME_MAX_POS));

    await fireEvent.input(slider, { target: { value: String(MASTER_VOLUME_MAX_POS) } });
    expect(setMasterVolume).toHaveBeenCalledWith(expect.anything(), 0);
  });

  test('toggling axes never sends a volume write by itself', async () => {
    synced(-10, -20);
    render(MasterVolumeMini);

    await fireEvent.click(screen.getByRole('button', { name: USER_AXIS_TOGGLE }));
    screen.getByRole('button', { name: MASTER_AXIS_TOGGLE }); // now in MASTER mode

    expect(setUserVolume).not.toHaveBeenCalled();
    expect(setMasterVolume).not.toHaveBeenCalled();
  });

  test('SaveMasterVolumeButton content is present only in MASTER mode', async () => {
    synced(-10, -20);
    render(MasterVolumeMini);

    expect(screen.queryByRole('button', { name: 'SAVE' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: USER_AXIS_TOGGLE }));
    expect(screen.getByRole('button', { name: 'SAVE' })).toBeInTheDocument();
  });

  test('mute button drives toggleMute in both axis modes', async () => {
    synced(-10, -20);
    render(MasterVolumeMini);

    await fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(toggleMute).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole('button', { name: USER_AXIS_TOGGLE }));
    await fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(toggleMute).toHaveBeenCalledTimes(2);
  });
});

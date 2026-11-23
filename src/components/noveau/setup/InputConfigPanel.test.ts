import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { AudioInputSource, I2sSlaveClockState, AdatInputLockState } from '@/domain';
import { Wire } from '@/protocol';

const stageInputSource = vi.fn();
const stageSpdifRxPin = vi.fn();
const stageSpdifRxPinExt = vi.fn();
const stageInputRate = vi.fn();
const stageSpdifInputOn = vi.fn();
const stageAdatInputEnabled = vi.fn();
const stageI2sInputEnabled = vi.fn();
const stageI2sRxPin = vi.fn();
const stageInputSourceName = vi.fn();

vi.mock('@/runtime', () => ({
  stageInputSource: (...a: unknown[]) => stageInputSource(...a),
  stageSpdifRxPin: (...a: unknown[]) => stageSpdifRxPin(...a),
  stageSpdifRxPinExt: (...a: unknown[]) => stageSpdifRxPinExt(...a),
  stageSpdifInputOn: (...a: unknown[]) => stageSpdifInputOn(...a),
  stageAdatInputEnabled: (...a: unknown[]) => stageAdatInputEnabled(...a),
  stageI2sInputEnabled: (...a: unknown[]) => stageI2sInputEnabled(...a),
  stageInputRate: (...a: unknown[]) => stageInputRate(...a),
  stageI2sRxPin: (...a: unknown[]) => stageI2sRxPin(...a),
  stageI2sInputChannels: vi.fn(),
  stageInputSourceName: (...a: unknown[]) => stageInputSourceName(...a),
}));

import InputConfigPanel from './InputConfigPanel.svelte';

const staging = {
  has: () => false,
  get: () => undefined,
  valueOf: (_key: string, live: unknown) => live,
  overlaySnapshot: (s: unknown) => s,
  entries: [],
  applying: false,
  stage: () => {},
  discard: () => {},
  discardAll: () => {},
  applyAll: async () => {},
};

function makeSnap(over: {
  source?: number; i2sClockMode?: number; i2sInputRateHz?: number;
  adatInputEnabled?: boolean; adatInputPin?: number; adatInputClockMode?: number;
  spdifRxPinExt?: number[]; spdifEnabled?: boolean; spdifCount?: number; spdifHoles?: number; i2sEnabled?: boolean;
} = {}) {
  return {
    platform: { type: 1 /* PlatformType.RP2350 */, name: 'RP2350', outputCount: 9, totalChannelCount: 11, pdmOutputIndex: 8 },
    outputPins: [6, 7, 8, 9, 10],
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0, clockPinMode: 0, bckPinSlave: 0 },
    inputConfig: {
      source: over.source ?? AudioInputSource.I2s,
      spdifRxPin: 5,
      spdifRxPinExt: over.spdifRxPinExt ?? [0, 0, 0],
      spdifEnabled: over.spdifEnabled ?? true,
      spdifCount: over.spdifCount ?? 1,
      spdifHoles: over.spdifHoles ?? 0,
      i2sEnabled: over.i2sEnabled ?? true,
      i2sRxPins: [15], i2sInputRateHz: over.i2sInputRateHz ?? 48000, i2sInputChannels: 2,
      i2sClockMode: over.i2sClockMode ?? 0,
      adatInputEnabled: over.adatInputEnabled ?? false,
      adatInputPin: over.adatInputPin ?? 0,
      adatInputClockMode: over.adatInputClockMode ?? 0,
    },
    dacHwMute: { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
    adat: { enabled: false, pin: 0 },
  };
}

function makeSession(o: {
  snap?: ReturnType<typeof makeSnap>;
  i2sSlaveStatus?: object | null;
  spdifStatus?: object | null;
  adatInputStatus?: object | null;
  spdifInputCount?: number;
  features?: object;
  staged?: Record<string, unknown>;
  names?: object;
} = {}) {
  return {
    device: { capabilities: { features: { adatInput: true, ...o.features }, spdifInputCount: o.spdifInputCount ?? 4 } },
    telemetry: { spdifRxStatus: o.spdifStatus ?? null, i2sSlaveStatus: o.i2sSlaveStatus ?? null, activeInputChannels: null, adatInputStatus: o.adatInputStatus ?? null },
    mirror: { current: o.snap ?? makeSnap() },
    names: { inputSources: {}, ...o.names },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging: o.staged ? { ...staging, has: (k: string) => k in o.staged!, valueOf: (k: string, live: unknown) => o.staged![k] ?? live } : staging,
  } as any;
}

const PAGED = { inputBlocks: true };

function renderPanel(session: unknown) {
  return render(InputConfigPanel, { context: new Map([[SESSION_KEY, session]]) });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('InputConfigPanel — I2S rate row', () => {
  test('MASTER clock mode keeps the interactive rate selector', () => {
    renderPanel(makeSession({ snap: makeSnap({ i2sClockMode: 0 }) }));
    expect(screen.getByRole('button', { name: '48k' })).toBeTruthy();
    expect(screen.queryByText(/auto-detected/)).toBeNull();
  });

  test('SLAVE clock mode replaces the rate selector with a read-only value', () => {
    renderPanel(makeSession({ snap: makeSnap({ i2sClockMode: 1 }) }));
    expect(screen.queryByRole('button', { name: '48k' })).toBeNull();
    expect(screen.getByText(/auto-detected/)).toBeTruthy();
  });

  test('SLAVE clock mode shows the detected rate once telemetry reports lock', () => {
    renderPanel(makeSession({
      snap: makeSnap({ i2sClockMode: 1 }),
      i2sSlaveStatus: { state: I2sSlaveClockState.Locked, detectedRateHz: 96000, clockMode: 1, lockCount: 1, lossCount: 0, measuredHz: 96000, slipCount: 0 },
    }));
    expect(screen.getByText('96.0 kHz')).toBeTruthy();
  });

  test('SLAVE clock mode shows a dash while not yet locked', () => {
    renderPanel(makeSession({
      snap: makeSnap({ i2sClockMode: 1 }),
      i2sSlaveStatus: { state: I2sSlaveClockState.Acquiring, detectedRateHz: 0, clockMode: 1, lockCount: 0, lossCount: 0, measuredHz: 0, slipCount: 0 },
    }));
    expect(screen.getAllByText('—').some((el) => el.classList.contains('val'))).toBe(true);
  });
});

describe('InputConfigPanel — ADAT', () => {
  const ADAT = { adatInput: true };

  test('no ADAT row appears while the input is off and not the source', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }), features: ADAT }));
    expect(screen.queryByRole('radio', { name: 'ADAT' })).toBeNull();
    expect(screen.queryByRole('switch', { name: /ADAT/ })).toBeNull();
  });

  test('an enabled ADAT input with a pin has a radio that picks it and no pin picker', async () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb, adatInputEnabled: true, adatInputPin: 20 }), features: ADAT }));
    expect(screen.queryByRole('button', { name: /ADAT.*pin/ })).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: 'ADAT' }));
    expect(stageInputSource).toHaveBeenCalledWith(expect.anything(), AudioInputSource.Adat);
  });

  test('the ADAT switch releases an enabled input, and is locked while ADAT is the source', async () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb, adatInputEnabled: true, adatInputPin: 20 }), features: ADAT }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Switch ADAT off' }));
    expect(stageAdatInputEnabled).toHaveBeenCalledWith(expect.anything(), false);
    unmount();

    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Adat, adatInputEnabled: true, adatInputPin: 20 }), features: ADAT }));
    expect(screen.getByRole('switch', { name: 'Switch ADAT off' }).getAttribute('aria-disabled')).toBe('true');
  });

  test('an enabled ADAT input without a pin keeps its row but offers no radio', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb, adatInputEnabled: true, adatInputPin: 0 }), features: ADAT }));
    expect(screen.getByText('ADAT')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'ADAT' })).toBeNull();
  });

  test('a preset-selected ADAT source shows a checked radio even without a pin, and the ADAT detail', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Adat }) }));
    expect(screen.getByRole('radio', { name: 'ADAT' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('ADAT INPUT')).toBeTruthy();
  });

  test('a staged ADAT source shows its row too', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }), staged: { inputSource: AudioInputSource.Adat } }));
    expect(screen.getByRole('radio', { name: 'ADAT' }).getAttribute('aria-checked')).toBe('true');
  });

  test('SLAVE clock mode renders the read-only auto-detected RATE row', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Adat, adatInputEnabled: true, adatInputPin: 20, adatInputClockMode: 1 }),
      adatInputStatus: { state: AdatInputLockState.Locked, clockMode: 1, enabled: true, pin: 20, rateOk: true, lockCount: 1, lossCount: 0, slipCount: 0, headerErr: 0, detectedRateHz: 48000, measuredHz: 48000 },
    }));
    expect(screen.getByText('48.0 kHz')).toBeTruthy();
    expect(screen.getByText(/auto-detected/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '48k' })).toBeNull();
  });

  test('MASTER clock mode disables the 96 kHz rate chip while 44.1/48 stay clickable', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Adat, adatInputEnabled: true, adatInputPin: 20, adatInputClockMode: 0, i2sInputRateHz: 44100 }),
    }));
    const chip96 = screen.getByRole('button', { name: '96k' });
    expect(chip96.hasAttribute('disabled')).toBe(true);
    expect(chip96.title).toMatch(/44\.1\/48 kHz only/);
    expect(screen.getByRole('button', { name: '48k' }).hasAttribute('disabled')).toBe(false);
  });

  test('a device rate above 48 kHz shows the parked warning', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Adat, adatInputEnabled: true, adatInputPin: 20, i2sInputRateHz: 96000 }),
      adatInputStatus: { state: AdatInputLockState.Acquiring, clockMode: 0, enabled: true, pin: 20, rateOk: false, lockCount: 0, lossCount: 0, slipCount: 0, headerErr: 0, detectedRateHz: 0, measuredHz: 0 },
    }));
    expect(screen.getByText(/PARKED/)).toBeTruthy();
  });

  test('the rename popover lists ADAT only while it is in play', async () => {
    const names = { inputSourcesSupported: true, inputSources: {} };
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }), features: ADAT, names }));
    await fireEvent.click(screen.getByRole('button', { name: 'Rename input sources' }));
    expect(screen.queryByRole('textbox', { name: 'Name for ADAT' })).toBeNull();
    unmount();

    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb, adatInputEnabled: true, adatInputPin: 20 }), features: ADAT, names }));
    await fireEvent.click(screen.getByRole('button', { name: 'Rename input sources' }));
    expect(screen.getByRole('textbox', { name: 'Name for ADAT' })).toBeTruthy();
  });
});

describe('InputConfigPanel — S/PDIF pin pickers', () => {
  test('an unconfigured ext S/PDIF input shows UNSET, unlike the always-configured primary', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Spdif, spdifCount: 2 }) }));
    expect(screen.getByRole('button', { name: 'S/PDIF 1 RX GPIO pin' }).textContent).toBe('GP5');
    expect(screen.getByRole('button', { name: 'S/PDIF 2 RX GPIO pin' }).textContent).toBe('UNSET');
  });

  test('ext S/PDIF pickers block re-selecting GP0 (the wire UNSET sentinel) once a real pin is assigned', () => {
    const snap = makeSnap({ source: AudioInputSource.Spdif, spdifRxPinExt: [20, 0, 0], spdifCount: 2 });
    renderPanel(makeSession({ snap }));
    // Only the ext rows' GP0 cell carries the sentinel reason; the primary
    // row's GP0 stays a normal free cell.
    expect((screen.getAllByTitle('GP0 · reserved as the UNSET sentinel')[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByTitle('GP0 · free')[0] as HTMLButtonElement).disabled).toBe(false);
  });

  test('all four S/PDIF inputs show a pin while on, even when the source is USB', () => {
    const snap = makeSnap({ source: AudioInputSource.Usb, spdifRxPinExt: [20, 21, 22], spdifCount: 4 });
    renderPanel(makeSession({ snap, features: PAGED }));
    expect(screen.getByRole('button', { name: 'S/PDIF 1 RX GPIO pin' }).textContent).toBe('GP5');
    expect(screen.getByRole('button', { name: 'S/PDIF 4 RX GPIO pin' }).textContent).toBe('GP22');
  });

  test('the pin picker is hidden while its input is off', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb, spdifCount: 2 }), features: PAGED }));
    expect(screen.queryByRole('button', { name: 'S/PDIF 2 RX GPIO pin' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'S/PDIF 3 RX GPIO pin' })).toBeNull();
  });

  test('a switched-off S/PDIF block hides every S/PDIF pin', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb, spdifEnabled: false }), features: PAGED }));
    expect(screen.queryByRole('button', { name: /S\/PDIF \d RX GPIO pin/ })).toBeNull();
  });

  test('the I2S pin hides while the I2S block is off', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb, i2sEnabled: false }), features: PAGED }));
    expect(screen.queryByRole('button', { name: /I2S RX data pin/ })).toBeNull();
  });
});

describe('InputConfigPanel — inputs list', () => {
  const sw = (name: string) => screen.getByRole('switch', { name }) as HTMLButtonElement;
  const radio = (name: string) => screen.getByRole('radio', { name });

  test('1.1.6 has no switch on S/PDIF 1 or I2S, while S/PDIF 2..4 keep theirs', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }) }));
    expect(screen.queryByRole('switch', { name: /S\/PDIF 1|I2S/ })).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
  });

  test('the radio of the effective source is on; only a pending source carries the staged dot', () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }) }));
    expect(radio('USB').getAttribute('aria-checked')).toBe('true');
    expect(radio('USB').classList.contains('staged')).toBe(false);
    unmount();

    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }), staged: { inputSource: AudioInputSource.Spdif2 } }));
    expect(radio('USB').getAttribute('aria-checked')).toBe('false');
    expect(radio('S/PDIF 2').getAttribute('aria-checked')).toBe('true');
    expect(radio('S/PDIF 2').classList.contains('staged')).toBe(true);
    expect(radio('USB').classList.contains('staged')).toBe(false);
  });

  test('a radio and its name both pick the source', async () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }) }));
    await fireEvent.click(radio('S/PDIF 3'));
    expect(stageInputSource).toHaveBeenLastCalledWith(expect.anything(), AudioInputSource.Spdif3);
    await fireEvent.click(screen.getByRole('button', { name: 'I2S' }));
    expect(stageInputSource).toHaveBeenLastCalledWith(expect.anything(), AudioInputSource.I2s);
  });

  test('a switch stages through stageSpdifInputOn with its input index', async () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb, spdifCount: 3 }), features: PAGED }));
    await fireEvent.click(sw('Switch S/PDIF 3 off'));
    expect(stageSpdifInputOn).toHaveBeenLastCalledWith(expect.anything(), 2, false);
    await fireEvent.click(sw('Switch S/PDIF 4 on'));
    expect(stageSpdifInputOn).toHaveBeenLastCalledWith(expect.anything(), 3, true);
  });

  test('the I2S switch stages the I2S block', async () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }), features: PAGED }));
    await fireEvent.click(sw('Switch I2S off'));
    expect(stageI2sInputEnabled).toHaveBeenCalledWith(expect.anything(), false);
  });

  test('inputs at or below the live source are locked; those above stay switchable', async () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Spdif2, spdifCount: 3 }), features: PAGED }));
    expect(sw('Switch S/PDIF 1 off').getAttribute('aria-disabled')).toBe('true');
    expect(sw('Switch S/PDIF 2 off').getAttribute('aria-disabled')).toBe('true');
    expect(sw('Switch S/PDIF 2 off').title).toBe('In use as the source');
    expect(sw('Switch S/PDIF 3 off').getAttribute('aria-disabled')).toBeNull();
    await fireEvent.click(sw('Switch S/PDIF 2 off'));
    expect(stageSpdifInputOn).not.toHaveBeenCalled();
  });

  test('a staged S/PDIF source locks the inputs up to it as well', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Usb, spdifCount: 1 }), features: PAGED,
      staged: { inputSource: AudioInputSource.Spdif3, spdifCount: 3 },
    }));
    expect(sw('Switch S/PDIF 3 off').getAttribute('aria-disabled')).toBe('true');
    expect(sw('Switch S/PDIF 4 on').getAttribute('aria-disabled')).toBeNull();
  });

  test('the I2S switch is locked while I2S is the source', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.I2s }), features: PAGED }));
    expect(sw('Switch I2S off').getAttribute('aria-disabled')).toBe('true');
  });

  test('a switch shows the staged dot and the device state only where it differs from the device', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Usb, spdifCount: 1 }), features: PAGED,
      staged: { spdifCount: 3 },
    }));
    const wrap = (name: string) => sw(name).closest('.stage-wrap')!;
    expect(wrap('Switch S/PDIF 2 off').classList.contains('staged')).toBe(true);
    expect(wrap('Switch S/PDIF 2 off').getAttribute('title')).toBe('device: OFF');
    expect(wrap('Switch S/PDIF 3 off').classList.contains('staged')).toBe(true);
    expect(wrap('Switch S/PDIF 4 on').classList.contains('staged')).toBe(false);
    expect(wrap('Switch S/PDIF 1 off').classList.contains('staged')).toBe(false);
    expect(wrap('Switch I2S off').classList.contains('staged')).toBe(false);
  });

  test('a staged cut of the S/PDIF block reads as on-device, off-staged', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Usb, spdifCount: 2 }), features: PAGED,
      staged: { spdifBlock: false },
    }));
    const wrap = sw('Switch S/PDIF 1 on').closest('.stage-wrap')!;
    expect(wrap.getAttribute('title')).toBe('device: ON');
    expect(sw('Switch S/PDIF 2 on').closest('.stage-wrap')!.getAttribute('title')).toBe('device: ON');
  });

  test('extra I2S pairs get a pin-only row each, while I2S is on', () => {
    const snap = makeSnap({ source: AudioInputSource.Usb });
    snap.inputConfig.i2sInputChannels = 6;
    snap.inputConfig.i2sRxPins = [15, 16, 17];
    const { unmount } = renderPanel(makeSession({ snap, features: { multichannelInput: true } }));
    expect(screen.getByText('Pair 2')).toBeTruthy();
    expect(screen.getByText('Pair 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I2S RX data pin, stereo pair 3' }).textContent).toBe('GP17');
    expect(screen.queryByRole('radio', { name: /Pair/ })).toBeNull();
    unmount();

    renderPanel(makeSession({ snap: { ...snap, inputConfig: { ...snap.inputConfig, i2sEnabled: false } }, features: PAGED }));
    expect(screen.queryByText('Pair 2')).toBeNull();
  });

  test('no pair rows with a stereo configuration', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }) }));
    expect(screen.queryByText('Pair 2')).toBeNull();
  });
});

describe('InputConfigPanel — detail area', () => {
  test('USB shows the detected width, and a pending USB source defers to APPLY', () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }) }));
    expect(screen.getByText('DETECTED')).toBeTruthy();
    unmount();

    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.I2s }), staged: { inputSource: AudioInputSource.Usb } }));
    expect(screen.queryByText('DETECTED')).toBeNull();
    expect(screen.getByText('Status appears after APPLY.')).toBeTruthy();
  });

  test('S/PDIF status shows the six rows for a live source, and the hint while pending', () => {
    const status = { state: 2, sampleRate: 48000, lockCount: 1, lossCount: 0, parityErrors: 0, fifoFillPct: 50 };
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Spdif2, spdifCount: 2 }), spdifStatus: status }));
    expect(screen.getByText('S/PDIF 2 STATUS')).toBeTruthy();
    expect(screen.getByText('FIFO FILL')).toBeTruthy();
    expect(screen.getByText('LOCKED')).toBeTruthy();
    unmount();

    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }), spdifStatus: status, staged: { inputSource: AudioInputSource.Spdif } }));
    expect(screen.queryByText('FIFO FILL')).toBeNull();
    expect(screen.getByText('Status appears after APPLY.')).toBeTruthy();
  });

  test('the I2S channels selector needs multichannel firmware', () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.I2s }) }));
    expect(screen.queryByText('CHANNELS')).toBeNull();
    unmount();
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.I2s }), features: { multichannelInput: true } }));
    expect(screen.getByText('CHANNELS')).toBeTruthy();
  });
});

describe('InputConfigPanel — pin reset', () => {
  const reset = () => screen.getByRole('button', { name: 'Reset input pins to defaults' });

  test('on an S/PDIF source it resets the visible S/PDIF pins only, skipping an ext input still UNSET', async () => {
    const snap = makeSnap({ source: AudioInputSource.Spdif, spdifRxPinExt: [20, 0, 0], spdifCount: 3 });
    renderPanel(makeSession({ snap, features: PAGED }));
    expect(reset().title).toBe('Reset S/PDIF pins to defaults');
    await fireEvent.click(reset());
    expect(stageSpdifRxPin).toHaveBeenCalledWith(expect.anything(), Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(stageSpdifRxPinExt).toHaveBeenCalledTimes(1);
    expect(stageSpdifRxPinExt).toHaveBeenCalledWith(expect.anything(), 0, Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(stageI2sRxPin).not.toHaveBeenCalled();
  });

  test('on I2S it resets every pair pin and never touches S/PDIF', async () => {
    const snap = makeSnap({ source: AudioInputSource.I2s });
    snap.inputConfig.i2sInputChannels = 4;
    snap.inputConfig.i2sRxPins = [15, 16];
    renderPanel(makeSession({ snap, features: { multichannelInput: true } }));
    expect(reset().title).toBe('Reset I2S pins to defaults');
    await fireEvent.click(reset());
    expect(stageI2sRxPin).toHaveBeenCalledTimes(2);
    expect(stageSpdifRxPin).not.toHaveBeenCalled();
    expect(stageSpdifRxPinExt).not.toHaveBeenCalled();
  });

  test('is hidden on USB, which has no pin pickers of its own', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }), features: PAGED }));
    expect(screen.queryByRole('button', { name: 'Reset input pins to defaults' })).toBeNull();
  });
});

describe('InputConfigPanel — gappy 1.1.6 mask', () => {
  const gappy = () => makeSnap({ source: AudioInputSource.Usb, spdifCount: 3, spdifHoles: 0b010, spdifRxPinExt: [20, 21, 0] });

  test('an input left off inside the count shows off, without a pin', () => {
    renderPanel(makeSession({ snap: gappy() }));
    expect(screen.getByRole('switch', { name: 'Switch S/PDIF 2 on' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'S/PDIF 2 RX GPIO pin' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Switch S/PDIF 3 off' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'S/PDIF 3 RX GPIO pin' })).toBeTruthy();
  });

  test('a staged count closes the hole', () => {
    renderPanel(makeSession({ snap: gappy(), staged: { spdifCount: 3 } }));
    expect(screen.getByRole('switch', { name: 'Switch S/PDIF 2 off' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'S/PDIF 2 RX GPIO pin' })).toBeTruthy();
  });

  test('a hole below the live source can be switched on, while the on inputs up to it stay locked', async () => {
    const snap = makeSnap({ source: AudioInputSource.Spdif3, spdifCount: 3, spdifHoles: 0b010, spdifRxPinExt: [20, 21, 0] });
    renderPanel(makeSession({ snap, features: PAGED }));
    expect(screen.getByRole('switch', { name: 'Switch S/PDIF 1 off' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Switch S/PDIF 3 off' }).getAttribute('aria-disabled')).toBe('true');
    const hole = screen.getByRole('switch', { name: 'Switch S/PDIF 2 on' });
    expect(hole.getAttribute('aria-disabled')).toBeNull();
    await fireEvent.click(hole);
    expect(stageSpdifInputOn).toHaveBeenCalledWith(expect.anything(), 1, true);
  });

  test('the switch of the hole stages through stageSpdifInputOn', async () => {
    renderPanel(makeSession({ snap: gappy() }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Switch S/PDIF 2 on' }));
    expect(stageSpdifInputOn).toHaveBeenCalledWith(expect.anything(), 1, true);
  });
});

describe('InputConfigPanel — custom names', () => {
  test('a renamed input keeps its name on its switch and pin labels', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Usb, spdifCount: 2 }), features: PAGED,
      names: { inputSources: { [AudioInputSource.Spdif2]: 'Coax' } },
    }));
    expect(screen.getByRole('switch', { name: 'Switch Coax off' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coax RX GPIO pin' })).toBeTruthy();
  });
});

describe('InputConfigPanel — source names', () => {
  const pencil = () => screen.getByRole('button', { name: 'Rename input sources' });
  const usbField = () => screen.getByRole('textbox', { name: 'Name for USB' }) as HTMLInputElement;
  const supported = { inputSourcesSupported: true, inputSources: { [AudioInputSource.Usb]: 'Desk' } };

  test('the pencil is hidden unless the device stores source names', () => {
    renderPanel(makeSession({ names: { inputSourcesSupported: false } }));
    expect(screen.queryByRole('button', { name: 'Rename input sources' })).toBeNull();
  });

  test('fields start with the stored name', async () => {
    renderPanel(makeSession({ names: supported }));
    await fireEvent.click(pencil());
    expect(usbField().value).toBe('Desk');
  });

  test('a staged name shows in its field with the staged marker and the device name as title', async () => {
    renderPanel(makeSession({ names: supported, staged: { [`inputSourceName:${AudioInputSource.Usb}`]: 'Studio' } }));
    await fireEvent.click(pencil());
    expect(usbField().value).toBe('Studio');
    const wrap = usbField().closest('.stage-wrap')!;
    expect(wrap.classList.contains('staged')).toBe(true);
    expect(wrap.getAttribute('title')).toBe('device: Desk');
  });

  test('committing a field stages that source only', async () => {
    renderPanel(makeSession({ names: supported }));
    await fireEvent.click(pencil());
    const field = screen.getByRole('textbox', { name: 'Name for I2S' });
    field.focus();
    await fireEvent.input(field, { target: { value: ' Turntable ' } });
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(stageInputSourceName).toHaveBeenCalledExactlyOnceWith(expect.anything(), AudioInputSource.I2s, 'Turntable');
  });

  test('clicking away stages a typed name exactly once', async () => {
    renderPanel(makeSession({ names: supported }));
    await fireEvent.click(pencil());
    usbField().focus();
    await fireEvent.input(usbField(), { target: { value: 'Studio' } });
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stageInputSourceName).toHaveBeenCalledExactlyOnceWith(expect.anything(), AudioInputSource.Usb, 'Studio');
  });

  test('Escape reverts a dirty field first, then closes; the pencil toggles', async () => {
    renderPanel(makeSession({ names: supported }));
    await fireEvent.click(pencil());
    usbField().focus();
    await fireEvent.input(usbField(), { target: { value: 'Oops' } });
    await fireEvent.keyDown(usbField(), { key: 'Escape' });
    expect(usbField().value).toBe('Desk');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await fireEvent.keyDown(usbField(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stageInputSourceName).not.toHaveBeenCalled();
    await fireEvent.click(pencil());
    await fireEvent.click(pencil());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

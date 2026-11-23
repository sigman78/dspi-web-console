import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { AudioInputSource, I2sSlaveClockState, AdatInputLockState } from '@/domain';
import { Wire } from '@/protocol';

const stageInputSource = vi.fn();
const stageSpdifRxPin = vi.fn();
const stageSpdifRxPinExt = vi.fn();
const stageInputRate = vi.fn();
const stageSpdifInputCount = vi.fn();
const stageSpdifBlockEnabled = vi.fn();
const stageI2sInputEnabled = vi.fn();
const stageI2sRxPin = vi.fn();
const stageInputSourceName = vi.fn();

vi.mock('@/runtime', () => ({
  stageInputSource: (...a: unknown[]) => stageInputSource(...a),
  stageSpdifRxPin: (...a: unknown[]) => stageSpdifRxPin(...a),
  stageSpdifRxPinExt: (...a: unknown[]) => stageSpdifRxPinExt(...a),
  stageSpdifInputCount: (...a: unknown[]) => stageSpdifInputCount(...a),
  stageSpdifBlockEnabled: (...a: unknown[]) => stageSpdifBlockEnabled(...a),
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
  spdifRxPinExt?: number[]; spdifEnabled?: boolean; spdifCount?: number; i2sEnabled?: boolean;
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
  adatInputStatus?: object | null;
  spdifInputCount?: number;
  features?: object;
  staged?: Record<string, unknown>;
  names?: object;
} = {}) {
  return {
    device: { capabilities: { features: { adatInput: true, ...o.features }, spdifInputCount: o.spdifInputCount ?? 1 } },
    telemetry: { spdifRxStatus: null, i2sSlaveStatus: o.i2sSlaveStatus ?? null, activeInputChannels: null, adatInputStatus: o.adatInputStatus ?? null },
    mirror: { current: o.snap ?? makeSnap() },
    names: { inputSources: {}, ...o.names },
    ctrlIfaces: { uart: null, i2c: null, status: null },
    controlSurfaces: { caps: null, nouns: [], bindings: [], status: null },
    staging: o.staged ? { ...staging, has: (k: string) => k in o.staged!, valueOf: (k: string, live: unknown) => o.staged![k] ?? live } : staging,
  } as any;
}

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

describe('InputConfigPanel — ADAT source', () => {
  test('the ADAT row has no radio until a pin is assigned, then picks ADAT', async () => {
    const { unmount } = renderPanel(makeSession({ snap: makeSnap({ adatInputEnabled: false, adatInputPin: 0 }) }));
    expect(screen.queryByRole('radio', { name: 'ADAT' })).toBeNull();
    expect(screen.getByText('NO PIN').title).toBe('Assign a pin in ADAT INPUT');
    unmount();

    renderPanel(makeSession({ snap: makeSnap({ adatInputEnabled: true, adatInputPin: 20 }) }));
    await fireEvent.click(screen.getByRole('radio', { name: 'ADAT' }));
    expect(stageInputSource).toHaveBeenCalledWith(expect.anything(), AudioInputSource.Adat);
  });

  test('a staged ADAT pin brings the radio and the switch', () => {
    renderPanel(makeSession({ snap: makeSnap({ adatInputPin: 0 }), staged: { adatInputPin: 20 } }));
    expect(screen.getByRole('radio', { name: 'ADAT' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Switch ADAT input on' })).toBeTruthy();
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
});

describe('InputConfigPanel — S/PDIF pin pickers', () => {
  test('an unconfigured ext S/PDIF input shows UNSET, unlike the always-configured primary', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Spdif, spdifCount: 2 }), spdifInputCount: 4 }));
    expect(screen.getByRole('button', { name: 'S/PDIF 1 RX GPIO pin' }).textContent).toBe('GP5');
    expect(screen.getByRole('button', { name: 'S/PDIF 2 RX GPIO pin' }).textContent).toBe('UNSET');
  });

  test('ext S/PDIF pickers block re-selecting GP0 (the wire UNSET sentinel) once a real pin is assigned', () => {
    const snap = makeSnap({ source: AudioInputSource.Spdif });
    snap.inputConfig.spdifRxPinExt = [20, 0, 0];
    snap.inputConfig.spdifCount = 2;
    renderPanel(makeSession({ snap, spdifInputCount: 4 }));

    // Only the ext row's GP0 cell carries the sentinel reason; the primary
    // row's GP0 stays a normal free cell.
    expect((screen.getByTitle('GP0 · reserved as the UNSET sentinel') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('GP0 · free') as HTMLButtonElement).disabled).toBe(false);
  });

  test('a V28+ device with spdifInputCount 4 renders all four S/PDIF RX pin rows, including input 4', () => {
    const snap = makeSnap({ source: AudioInputSource.Spdif, spdifRxPinExt: [20, 21, 22], spdifCount: 4 });
    renderPanel(makeSession({ snap, spdifInputCount: 4 }));
    expect(screen.getByRole('button', { name: 'S/PDIF 1 RX GPIO pin' }).textContent).toBe('GP5');
    expect(screen.getByRole('button', { name: 'S/PDIF 2 RX GPIO pin' }).textContent).toBe('GP20');
    expect(screen.getByRole('button', { name: 'S/PDIF 3 RX GPIO pin' }).textContent).toBe('GP21');
    expect(screen.getByRole('button', { name: 'S/PDIF 4 RX GPIO pin' }).textContent).toBe('GP22');
  });
});

describe('InputConfigPanel — inputs list', () => {
  const PAGED = { inputBlocks: true };
  const sw = (name: string) => screen.getByRole('switch', { name });

  test('a 1.1.6 device tags S/PDIF and I2S as always on and has no block switches', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }) }));
    expect(screen.getAllByText('ALWAYS')).toHaveLength(2);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  test('the block of the live source reads IN USE; the others keep a working switch', async () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.I2s }), features: PAGED }));
    expect(screen.getByText('IN USE')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /I2S/ })).toBeNull();
    await fireEvent.click(sw('Switch S/PDIF inputs off'));
    expect(stageSpdifBlockEnabled).toHaveBeenCalledWith(expect.anything(), false);
  });

  test('a block hosting only the staged source reads PENDING, with the switch-on hint when it is staged on', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Usb, i2sEnabled: false }), features: PAGED,
      staged: { inputSource: AudioInputSource.I2s, i2sBlock: true },
    }));
    expect(screen.getByText('PENDING').title).toBe('device: OFF, switches on with apply');
    expect(screen.queryByRole('switch', { name: /I2S/ })).toBeNull();
  });

  test('a pending S/PDIF target beyond the live count looks selected, not like an added input', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Usb, spdifCount: 2 }), spdifInputCount: 4, features: PAGED,
      staged: { inputSource: AudioInputSource.Spdif3, spdifCount: 3 },
    }));
    const radio = screen.getByRole('radio', { name: 'S/PDIF 3' });
    expect(radio.classList.contains('target')).toBe(true);
    expect(radio.classList.contains('added')).toBe(false);
  });

  test('the staged S/PDIF source keeps its radio even when the staged count cuts it', () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Usb, spdifCount: 2 }), spdifInputCount: 4, features: PAGED,
      staged: { inputSource: AudioInputSource.Spdif4 },
    }));
    expect(screen.getByRole('radio', { name: 'S/PDIF 4' }).classList.contains('target')).toBe(true);
  });

  test('a staged ADAT disable keeps the switch even after the pin is cleared', () => {
    renderPanel(makeSession({
      snap: makeSnap({ adatInputEnabled: true, adatInputPin: 20 }),
      staged: { adatInputEnable: false, adatInputPin: 0 },
    }));
    expect(screen.queryByText('NO PIN')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Switch ADAT input on' })).toBeTruthy();
  });

  test('a radio stages its own source: S/PDIF digit k is input k', async () => {
    renderPanel(makeSession({
      snap: makeSnap({ source: AudioInputSource.Usb, spdifCount: 3 }), spdifInputCount: 4, features: PAGED,
    }));
    await fireEvent.click(screen.getByRole('radio', { name: 'S/PDIF 3' }));
    expect(stageInputSource).toHaveBeenCalledWith(expect.anything(), AudioInputSource.Spdif3);
    await fireEvent.click(screen.getByRole('radio', { name: 'I2S' }));
    expect(stageInputSource).toHaveBeenCalledWith(expect.anything(), AudioInputSource.I2s);
  });
});

describe('InputConfigPanel — S/PDIF count', () => {
  const PAGED = { inputBlocks: true };
  const base = (over: Parameters<typeof makeSnap>[0]) => makeSnap({ source: AudioInputSource.Usb, ...over });

  test('the highest input cannot be removed while it is the live source, and Add is absent at the maximum', () => {
    const { unmount } = renderPanel(makeSession({
      snap: base({ source: AudioInputSource.Spdif3, spdifCount: 3 }), spdifInputCount: 4, features: PAGED,
    }));
    expect(screen.queryByRole('button', { name: /Remove S\/PDIF input/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add S/PDIF input 4' })).toBeTruthy();
    unmount();

    renderPanel(makeSession({ snap: base({ spdifCount: 4 }), spdifInputCount: 4, features: PAGED }));
    expect(screen.queryByRole('button', { name: /Add S\/PDIF input/ })).toBeNull();
  });

  test('the highest input cannot be removed while it is the staged source either', () => {
    renderPanel(makeSession({
      snap: base({ spdifCount: 3 }), spdifInputCount: 4, features: PAGED,
      staged: { inputSource: AudioInputSource.Spdif3 },
    }));
    expect(screen.queryByRole('button', { name: /Remove S\/PDIF input/ })).toBeNull();
  });

  test('Remove and Add stage the count one step', async () => {
    renderPanel(makeSession({ snap: base({ spdifCount: 3 }), spdifInputCount: 4, features: PAGED }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove S/PDIF input 3' }));
    expect(stageSpdifInputCount).toHaveBeenLastCalledWith(expect.anything(), 2);
    await fireEvent.click(screen.getByRole('button', { name: 'Add S/PDIF input 4' }));
    expect(stageSpdifInputCount).toHaveBeenLastCalledWith(expect.anything(), 4);
  });

  test('an input cut by the staged count stays as a ghost, and clicking it restores the count', async () => {
    renderPanel(makeSession({
      snap: base({ spdifCount: 3 }), spdifInputCount: 4, features: PAGED, staged: { spdifCount: 2 },
    }));
    const ghost = screen.getByRole('radio', { name: 'Restore S/PDIF 3' });
    expect(ghost.classList.contains('removed')).toBe(true);
    await fireEvent.click(ghost);
    expect(stageSpdifInputCount).toHaveBeenCalledWith(expect.anything(), 3);
    expect(stageInputSource).not.toHaveBeenCalled();
  });

  test('one pin row per input in the staged count', () => {
    renderPanel(makeSession({
      snap: base({ source: AudioInputSource.Spdif, spdifCount: 2 }), spdifInputCount: 4, features: PAGED,
    }));
    expect(screen.queryByRole('button', { name: 'S/PDIF 2 RX GPIO pin' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'S/PDIF 3 RX GPIO pin' })).toBeNull();
  });
});

describe('InputConfigPanel — DEFAULTS chip', () => {
  test('is hidden on the USB source, which has no pin pickers', () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.Usb }) }));
    expect(screen.queryByRole('button', { name: 'Reset input pins to defaults' })).toBeNull();
  });

  test('SPDIF view stages a reset for configured pins but skips ext inputs still at the UNSET sentinel', async () => {
    const snap = makeSnap({ source: AudioInputSource.Spdif });
    snap.inputConfig.spdifRxPinExt = [20, 0];
    snap.inputConfig.spdifCount = 3;
    renderPanel(makeSession({ snap, spdifInputCount: 4 }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reset input pins to defaults' }));
    expect(stageSpdifRxPin).toHaveBeenCalledWith(expect.anything(), Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(stageSpdifRxPinExt).toHaveBeenCalledWith(expect.anything(), 0, Wire.Const.PIN_RESET_TO_DEFAULT);
    // S/PDIF 3 is unset -- a reset would assign a GPIO with no way back to UNSET.
    expect(stageSpdifRxPinExt).not.toHaveBeenCalledWith(expect.anything(), 1, expect.anything());
  });

  test('I2S view stages a reset for every active RX pair, and never touches S/PDIF', async () => {
    renderPanel(makeSession({ snap: makeSnap({ source: AudioInputSource.I2s }) }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reset input pins to defaults' }));
    expect(stageI2sRxPin).toHaveBeenCalledWith(expect.anything(), 0, Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(stageSpdifRxPin).not.toHaveBeenCalled();
    expect(stageSpdifRxPinExt).not.toHaveBeenCalled();
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

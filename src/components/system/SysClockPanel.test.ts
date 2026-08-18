import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { SysClockMode, SYS_CLOCK_VREG_DEFAULT, PlatformType } from '@/domain';

const applySysClock = vi.fn();
const refreshSysClock = vi.fn();
let mockConnected = true;

vi.mock('@/runtime', () => ({
  applySysClock: (...a: unknown[]) => applySysClock(...a),
  refreshSysClock: (...a: unknown[]) => refreshSysClock(...a),
}));

vi.mock('@/state', () => ({
  connection: { get connected() { return mockConnected; }, get phase() { return 'ready'; } },
}));

import SysClockPanel from './SysClockPanel.svelte';

function makeStatus(over: {
  activeMode?: number; storedMode?: number; storedVregSel?: number; liveVreg?: number; fallbackActive?: boolean;
} = {}) {
  return {
    activeMode: SysClockMode.Mhz307p2,
    storedMode: SysClockMode.Mhz307p2,
    storedVregSel: SYS_CLOCK_VREG_DEFAULT,
    liveVreg: 12,
    fallbackActive: false,
    ...over,
  };
}

function makeSession(o: { status?: object | null; platform?: number; busy?: boolean } = {}) {
  return {
    sysClock: { status: 'status' in o ? o.status : makeStatus(), busy: o.busy ?? false },
    mirror: { current: { platform: { type: o.platform ?? PlatformType.RP2350 } } },
  } as unknown;
}

function renderPanel(session: unknown) {
  return render(SysClockPanel, { context: new Map([[SESSION_KEY, session]]) });
}

beforeEach(() => { vi.clearAllMocks(); mockConnected = true; });

describe('SysClockPanel', () => {
  test('renders nothing when the status probe found no support (or has not landed yet)', () => {
    renderPanel(makeSession({ status: null }));
    expect(screen.queryByText('SYSTEM CLOCK')).toBeNull();
  });

  test('renders the mode radiogroup and voltage select once a status is present', () => {
    renderPanel(makeSession());
    expect(screen.getByRole('radiogroup', { name: 'System clock mode' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Core voltage' })).toBeTruthy();
  });

  test('voltage options start at the pending mode default, never below it', () => {
    const status = makeStatus({ storedMode: SysClockMode.Mhz384, activeMode: SysClockMode.Mhz384, liveVreg: 13 });
    renderPanel(makeSession({ status, platform: PlatformType.RP2350 }));
    const select = screen.getByRole('combobox', { name: 'Core voltage' }) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes('1.15'))).toBe(false);
    expect(labels).toContain('1.20 V');
  });

  test('RP2040 voltage options top out at 1.30 V', () => {
    renderPanel(makeSession({ platform: PlatformType.RP2040 }));
    const select = screen.getByRole('combobox', { name: 'Core voltage' }) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent ?? '');
    expect(labels).toContain('1.30 V');
    expect(labels.some((l) => l.includes('1.35'))).toBe(false);
  });

  test('RP2350 voltage options extend to 1.50 V, bench-marked from 1.35 V', () => {
    renderPanel(makeSession({ platform: PlatformType.RP2350 }));
    const select = screen.getByRole('combobox', { name: 'Core voltage' }) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent ?? '');
    expect(labels).toContain('1.50 V — BENCH');
    expect(labels).toContain('1.35 V — BENCH');
    expect(labels).toContain('1.30 V');
  });

  test('switching to a mode whose default exceeds an explicit voltage resets voltage to DEFAULT', async () => {
    renderPanel(makeSession());
    const volt = screen.getByRole('combobox', { name: 'Core voltage' }) as HTMLSelectElement;
    await fireEvent.change(volt, { target: { value: '12' } });
    await fireEvent.click(screen.getByRole('radio', { name: '384' }));
    expect((screen.getByRole('combobox', { name: 'Core voltage' }) as HTMLSelectElement).value).toBe(String(SYS_CLOCK_VREG_DEFAULT));
  });

  test('APPLY is disabled while pending matches stored, and enables after a mode change', async () => {
    renderPanel(makeSession());
    expect(screen.getByRole('button', { name: 'APPLY' }).getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(screen.getByRole('radio', { name: '384' }));
    expect(screen.getByRole('button', { name: 'APPLY' }).getAttribute('aria-disabled')).toBe('false');
  });

  test('confirming APPLY sends the pending mode and voltage', async () => {
    renderPanel(makeSession());
    await fireEvent.click(screen.getByRole('radio', { name: '384' }));
    await fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    await fireEvent.click(screen.getByRole('button', { name: /CONFIRM/ }));
    expect(applySysClock).toHaveBeenCalledWith(expect.anything(), SysClockMode.Mhz384, SYS_CLOCK_VREG_DEFAULT);
  });

  test('fallback banner appears with RETRY (stored) and REVERT (safe default) actions', async () => {
    const status = makeStatus({ activeMode: SysClockMode.Mhz307p2, storedMode: SysClockMode.Mhz480, storedVregSel: 15, fallbackActive: true });
    renderPanel(makeSession({ status }));
    expect(screen.getByRole('alert', { name: 'System clock fallback' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'RETRY' }));
    expect(applySysClock).toHaveBeenLastCalledWith(expect.anything(), SysClockMode.Mhz480, 15);

    await fireEvent.click(screen.getByRole('button', { name: 'REVERT' }));
    expect(applySysClock).toHaveBeenLastCalledWith(expect.anything(), SysClockMode.Mhz307p2, SYS_CLOCK_VREG_DEFAULT);
  });

  test('shows a pending-apply hint when active and stored modes disagree without a fallback', () => {
    const status = makeStatus({ activeMode: SysClockMode.Mhz307p2, storedMode: SysClockMode.Mhz384, fallbackActive: false });
    renderPanel(makeSession({ status }));
    expect(screen.getByText(/hasn't taken effect yet/)).toBeTruthy();
  });

  test('disconnected: APPLY carries the connect reason and mode/voltage/REFRESH are disabled', () => {
    mockConnected = false;
    renderPanel(makeSession());
    expect(screen.getByRole('button', { name: 'APPLY' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Connect a device to enable this action.')).toBeTruthy();
    expect((screen.getByRole('radio', { name: '384' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Core voltage' }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'REFRESH' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('busy apply disables every control including the fallback actions', () => {
    const status = makeStatus({ storedMode: SysClockMode.Mhz480, fallbackActive: true });
    renderPanel(makeSession({ status, busy: true }));
    expect(screen.getByRole('button', { name: 'APPLY' }).getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByRole('radio', { name: '384' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Core voltage' }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'RETRY' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'REVERT' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'REFRESH' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('the selection survives an apply that the device did not accept', async () => {
    renderPanel(makeSession());
    await fireEvent.click(screen.getByRole('radio', { name: '384' }));
    await fireEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    await fireEvent.click(screen.getByRole('button', { name: /CONFIRM/ }));
    await Promise.resolve();
    expect((screen.getByRole('radio', { name: '384' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
  });

  test('REFRESH re-reads the status through the runtime verb', async () => {
    renderPanel(makeSession());
    await fireEvent.click(screen.getByRole('button', { name: 'REFRESH' }));
    expect(refreshSysClock).toHaveBeenCalledTimes(1);
  });
});

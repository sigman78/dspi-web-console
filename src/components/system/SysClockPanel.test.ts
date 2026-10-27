import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { SESSION_KEY } from '@/components/sessionContext';
import { createStagingState } from '@/state';
import { SysClockMode, SYS_CLOCK_VREG_DEFAULT, PlatformType } from '@/domain';

const applySysClock = vi.fn();
const refreshSysClock = vi.fn();

vi.mock('@/runtime', async () => {
  const staged = await vi.importActual<typeof import('@/runtime/stagedActions')>('@/runtime/stagedActions');
  return {
    stageSysClockMode: staged.stageSysClockMode,
    stageSysClockVreg: staged.stageSysClockVreg,
    applySysClock: (...a: unknown[]) => applySysClock(...a),
    refreshSysClock: (...a: unknown[]) => refreshSysClock(...a),
  };
});

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
    staging: createStagingState(),
  } as any;
}

function renderPanel(session: unknown) {
  return render(SysClockPanel, { context: new Map([[SESSION_KEY, session]]) });
}

beforeEach(() => { vi.clearAllMocks(); });

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

  test('switching to a mode whose default exceeds an explicit voltage stages a visible DEFAULT voltage', async () => {
    const session = makeSession({ status: makeStatus({ storedVregSel: 12 }) });
    renderPanel(session);
    await fireEvent.click(screen.getByRole('radio', { name: '384' }));
    expect((screen.getByRole('combobox', { name: 'Core voltage' }) as HTMLSelectElement).value).toBe(String(SYS_CLOCK_VREG_DEFAULT));
    expect(session.staging.get('sysClock:vreg')?.to).toBe('default');
    expect(session.staging.get('sysClock:mode')?.disruptive).toBeTruthy();
  });

  test('picking a mode stages it without writing, and the panel has no APPLY of its own', async () => {
    const session = makeSession();
    renderPanel(session);
    await fireEvent.click(screen.getByRole('radio', { name: '384' }));
    expect(session.staging.has('sysClock:mode')).toBe(true);
    expect(applySysClock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'APPLY' })).toBeNull();
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

  test('busy apply disables every control including the fallback actions', () => {
    const status = makeStatus({ storedMode: SysClockMode.Mhz480, fallbackActive: true });
    renderPanel(makeSession({ status, busy: true }));
    expect((screen.getByRole('radio', { name: '384' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Core voltage' }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'RETRY' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'REVERT' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'REFRESH' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('REFRESH re-reads the status through the runtime verb', async () => {
    renderPanel(makeSession());
    await fireEvent.click(screen.getByRole('button', { name: 'REFRESH' }));
    expect(refreshSysClock).toHaveBeenCalledTimes(1);
  });
});

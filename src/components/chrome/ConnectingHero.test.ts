import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConnectingHero from './ConnectingHero.svelte';
import { dispatch } from '@/state';

vi.mock('../../runtime/boot', () => ({
  connectRequested: vi.fn().mockResolvedValue(undefined),
  reportConnectError: vi.fn(),
  webUsbUnsupportedReason: vi.fn(() => null),
}));

import { connectRequested, webUsbUnsupportedReason } from '@/runtime';

beforeEach(() => {
  dispatch({ t: 'disconnected' });
  vi.mocked(webUsbUnsupportedReason).mockReturnValue(null);
});

describe('ConnectingHero — status text', () => {
  test('noDevice → WAITING FOR DEVICE…', () => {
    dispatch({ t: 'disconnected' });
    render(ConnectingHero);
    expect(screen.getByText('WAITING FOR DEVICE…')).toBeInTheDocument();
  });

  test('connecting → CONNECTING…', () => {
    dispatch({ t: 'requested' });
    render(ConnectingHero);
    expect(screen.getByText('CONNECTING…')).toBeInTheDocument();
  });

  test('error → ERROR status with full diagnostics panel', () => {
    const full = 'usb pipe broken\n  at transfer (chunk.js:42)\n  at connect (chunk.js:17)';
    dispatch({ t: 'failed', message: full });
    render(ConnectingHero);
    expect(screen.getByText('ERROR')).toBeInTheDocument();
    const panel = screen.getByRole('alert');
    expect(panel).toHaveTextContent('usb pipe broken');
    expect(panel).toHaveTextContent('at transfer (chunk.js:42)');
    expect(panel).toHaveTextContent('at connect (chunk.js:17)');
  });

  test('non-error states do not render the diagnostics panel', () => {
    dispatch({ t: 'disconnected' });
    render(ConnectingHero);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('unsupported-firmware error renders a dedicated upgrade panel, not the red diagnostics one', () => {
    dispatch({
      t: 'failed',
      message: 'DSPi firmware 1.1.2 is below the minimum supported 1.1.3. Update the device firmware to 1.1.3 or newer, then reconnect.',
      errorKind: 'unsupported-firmware',
    });
    render(ConnectingHero);
    const panel = screen.getByRole('alert', { name: /firmware/i });
    expect(panel).toHaveTextContent('1.1.2');
    expect(panel).toHaveTextContent('1.1.3');
    expect(screen.queryByLabelText('Connection error details')).not.toBeInTheDocument();
    // Retry stays available — the user can reconnect after updating.
    expect(screen.getByRole('button', { name: 'CONNECT' })).not.toBeDisabled();
  });
});

describe('ConnectingHero — button behavior', () => {
  test('noDevice → button enabled', () => {
    dispatch({ t: 'disconnected' });
    render(ConnectingHero);
    expect(screen.getByRole('button', { name: 'CONNECT' })).not.toBeDisabled();
  });

  test('connecting → button disabled', () => {
    dispatch({ t: 'requested' });
    render(ConnectingHero);
    expect(screen.getByRole('button', { name: 'CONNECT' })).toBeDisabled();
  });

  test('error → button enabled (allows retry)', () => {
    dispatch({ t: 'failed', message: 'oops' });
    render(ConnectingHero);
    expect(screen.getByRole('button', { name: 'CONNECT' })).not.toBeDisabled();
  });

  test('webusb unsupported → CONNECT button is not rendered', () => {
    vi.mocked(webUsbUnsupportedReason).mockReturnValue('no navigator.usb');
    dispatch({ t: 'disconnected' });
    render(ConnectingHero);
    expect(screen.queryByRole('button', { name: 'CONNECT' })).not.toBeInTheDocument();
  });

  test('webusb unsupported → renders the reason in an alert panel', () => {
    vi.mocked(webUsbUnsupportedReason).mockReturnValue('this browser cannot do USB');
    dispatch({ t: 'disconnected' });
    render(ConnectingHero);
    const panel = screen.getByRole('alert');
    expect(panel).toHaveTextContent('this browser cannot do USB');
  });

  test('clicking enabled button calls connectRequested once', async () => {
    dispatch({ t: 'disconnected' });
    vi.mocked(connectRequested).mockClear();
    render(ConnectingHero);
    await fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }));
    expect(connectRequested).toHaveBeenCalledTimes(1);
  });

  test('clicking disabled button does not call connectRequested', async () => {
    dispatch({ t: 'requested' });
    vi.mocked(connectRequested).mockClear();
    render(ConnectingHero);
    await fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }));
    expect(connectRequested).not.toHaveBeenCalled();
  });
});

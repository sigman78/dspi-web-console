import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConnectingHero from './ConnectingHero.svelte';
import { setStatus } from '@/state';

vi.mock('../../runtime/session', () => ({
  connectRequested: vi.fn().mockResolvedValue(undefined),
  webUsbUnsupportedReason: vi.fn(() => null),
}));

import { connectRequested, webUsbUnsupportedReason } from '@/runtime';

beforeEach(() => {
  setStatus('idle');
  vi.mocked(webUsbUnsupportedReason).mockReturnValue(null);
});

describe('ConnectingHero — status text', () => {
  test('idle → WAITING FOR DEVICE...', () => {
    setStatus('idle');
    render(ConnectingHero);
    expect(screen.getByText('WAITING FOR DEVICE...')).toBeInTheDocument();
  });

  test('connecting → CONNECTING…', () => {
    setStatus('connecting');
    render(ConnectingHero);
    expect(screen.getByText('CONNECTING…')).toBeInTheDocument();
  });

  test('disconnected → DISCONNECTED', () => {
    setStatus('disconnected');
    render(ConnectingHero);
    expect(screen.getByText('DISCONNECTED')).toBeInTheDocument();
  });

  test('error → ERROR status with full diagnostics panel', () => {
    const full = 'usb pipe broken\n  at transfer (chunk.js:42)\n  at connect (chunk.js:17)';
    setStatus('error', full);
    render(ConnectingHero);
    expect(screen.getByText('ERROR')).toBeInTheDocument();
    const panel = screen.getByRole('alert');
    expect(panel).toHaveTextContent('usb pipe broken');
    expect(panel).toHaveTextContent('at transfer (chunk.js:42)');
    expect(panel).toHaveTextContent('at connect (chunk.js:17)');
  });

  test('non-error states do not render the diagnostics panel', () => {
    setStatus('idle');
    render(ConnectingHero);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('webusb unsupported → WEBUSB UNAVAILABLE', () => {
    vi.mocked(webUsbUnsupportedReason).mockReturnValue('no navigator.usb');
    setStatus('idle');
    render(ConnectingHero);
    expect(screen.getByText('WEBUSB UNAVAILABLE', { selector: '.status' })).toBeInTheDocument();
  });

  test('renders the EQ spectrum (16 bars)', () => {
    const { container } = render(ConnectingHero);
    expect(container.querySelectorAll('.bar')).toHaveLength(16);
  });
});

describe('ConnectingHero — button behavior', () => {
  test('idle → button enabled', () => {
    setStatus('idle');
    render(ConnectingHero);
    expect(screen.getByRole('button', { name: 'CONNECT' })).not.toBeDisabled();
  });

  test('connecting → button disabled', () => {
    setStatus('connecting');
    render(ConnectingHero);
    expect(screen.getByRole('button', { name: 'CONNECT' })).toBeDisabled();
  });

  test('disconnected → button enabled (allows retry)', () => {
    setStatus('disconnected');
    render(ConnectingHero);
    expect(screen.getByRole('button', { name: 'CONNECT' })).not.toBeDisabled();
  });

  test('error → button enabled (allows retry)', () => {
    setStatus('error', 'oops');
    render(ConnectingHero);
    expect(screen.getByRole('button', { name: 'CONNECT' })).not.toBeDisabled();
  });

  test('webusb unsupported → CONNECT button is not rendered', () => {
    vi.mocked(webUsbUnsupportedReason).mockReturnValue('no navigator.usb');
    setStatus('idle');
    render(ConnectingHero);
    expect(screen.queryByRole('button', { name: 'CONNECT' })).not.toBeInTheDocument();
  });

  test('webusb unsupported → renders the reason in an alert panel', () => {
    vi.mocked(webUsbUnsupportedReason).mockReturnValue('this browser cannot do USB');
    setStatus('idle');
    render(ConnectingHero);
    const panel = screen.getByRole('alert');
    expect(panel).toHaveTextContent('this browser cannot do USB');
  });

  test('clicking enabled button calls connectRequested once', async () => {
    setStatus('idle');
    vi.mocked(connectRequested).mockClear();
    render(ConnectingHero);
    await fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }));
    expect(connectRequested).toHaveBeenCalledTimes(1);
  });

  test('clicking disabled button does not call connectRequested', async () => {
    setStatus('connecting');
    vi.mocked(connectRequested).mockClear();
    render(ConnectingHero);
    await fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }));
    expect(connectRequested).not.toHaveBeenCalled();
  });
});

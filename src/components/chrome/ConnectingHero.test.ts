import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConnectingHero from './ConnectingHero.svelte';
import { setStatus } from '../../state';

vi.mock('../../runtime/session', () => ({
  connectRequested: vi.fn().mockResolvedValue(undefined),
  webUsbUnsupportedReason: vi.fn(() => null),
}));

import { connectRequested, webUsbUnsupportedReason } from '../../runtime/session';

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

  test('error → ERROR · <message>', () => {
    setStatus('error', 'usb pipe broken');
    render(ConnectingHero);
    expect(screen.getByText('ERROR · usb pipe broken')).toBeInTheDocument();
  });

  test('webusb unsupported → WEBUSB UNAVAILABLE', () => {
    vi.mocked(webUsbUnsupportedReason).mockReturnValue('no navigator.usb');
    setStatus('idle');
    render(ConnectingHero);
    expect(screen.getByText('WEBUSB UNAVAILABLE')).toBeInTheDocument();
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

  test('webusb unsupported → button disabled', () => {
    vi.mocked(webUsbUnsupportedReason).mockReturnValue('no navigator.usb');
    setStatus('idle');
    render(ConnectingHero);
    expect(screen.getByRole('button', { name: 'CONNECT' })).toBeDisabled();
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

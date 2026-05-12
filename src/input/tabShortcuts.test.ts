import { describe, it, expect, beforeEach } from 'vitest';
import { handleTabShortcut } from './tabShortcuts';
import { settings, setTab } from '../state/settings.svelte';

function ev(init: Partial<KeyboardEventInit> & { code: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', { altKey: true, ...init });
}

describe('handleTabShortcut', () => {
  beforeEach(() => { setTab('overview'); });

  it('Alt+1 jumps to overview', () => {
    setTab('mixer');
    const consumed = handleTabShortcut(ev({ code: 'Digit1' }));
    expect(consumed).toBe(true);
    expect(settings.tab).toBe('overview');
  });

  it('Alt+3 jumps to mixer', () => {
    const consumed = handleTabShortcut(ev({ code: 'Digit3' }));
    expect(consumed).toBe(true);
    expect(settings.tab).toBe('mixer');
  });

  it('Alt+5 jumps to system', () => {
    handleTabShortcut(ev({ code: 'Digit5' }));
    expect(settings.tab).toBe('system');
  });

  it('Alt+] cycles forward', () => {
    setTab('eq');
    handleTabShortcut(ev({ code: 'BracketRight' }));
    expect(settings.tab).toBe('mixer');
  });

  it('Alt+] wraps from system back to overview', () => {
    setTab('system');
    handleTabShortcut(ev({ code: 'BracketRight' }));
    expect(settings.tab).toBe('overview');
  });

  it('Alt+[ cycles backward', () => {
    setTab('mixer');
    handleTabShortcut(ev({ code: 'BracketLeft' }));
    expect(settings.tab).toBe('eq');
  });

  it('Alt+[ wraps from overview back to system', () => {
    setTab('overview');
    handleTabShortcut(ev({ code: 'BracketLeft' }));
    expect(settings.tab).toBe('system');
  });

  it('returns false (no-op) when alt is not held', () => {
    const e = new KeyboardEvent('keydown', { code: 'Digit2', altKey: false });
    const consumed = handleTabShortcut(e);
    expect(consumed).toBe(false);
    expect(settings.tab).toBe('overview');
  });

  it('returns false when ctrl/meta/shift are also held', () => {
    expect(handleTabShortcut(ev({ code: 'Digit2', ctrlKey: true }))).toBe(false);
    expect(handleTabShortcut(ev({ code: 'Digit2', metaKey: true }))).toBe(false);
    expect(handleTabShortcut(ev({ code: 'Digit2', shiftKey: true }))).toBe(false);
    expect(settings.tab).toBe('overview');
  });

  it('ignores Alt+0 and Alt+6 (out of range)', () => {
    expect(handleTabShortcut(ev({ code: 'Digit0' }))).toBe(false);
    expect(handleTabShortcut(ev({ code: 'Digit6' }))).toBe(false);
    expect(settings.tab).toBe('overview');
  });

  it('ignores unrelated alt-keys', () => {
    expect(handleTabShortcut(ev({ code: 'KeyA' }))).toBe(false);
    expect(settings.tab).toBe('overview');
  });
});

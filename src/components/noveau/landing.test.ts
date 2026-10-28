import { describe, test, expect, afterEach } from 'vitest';
import { APP_VERSION } from '@/buildInfo';
import { settings } from '@/state';
import { noveauUi } from './noveauUi.svelte';
import { applyLanding } from './landing';

afterEach(() => { settings.seenVersion = null; noveauUi.destination = 'tune'; });

describe('applyLanding', () => {
  test('first run opens ABOUT and stamps the version', () => {
    settings.seenVersion = null;
    applyLanding();
    expect(noveauUi.destination).toBe('about');
    expect(settings.seenVersion).toBe(APP_VERSION);
  });

  test('a later launch on the same version opens TUNE', () => {
    applyLanding();
    noveauUi.destination = 'setup';
    applyLanding();
    expect(noveauUi.destination).toBe('tune');
  });

  test('a console update opens ABOUT once', () => {
    settings.seenVersion = '0.0.1';
    applyLanding();
    expect(noveauUi.destination).toBe('about');
    applyLanding();
    expect(noveauUi.destination).toBe('tune');
  });
});

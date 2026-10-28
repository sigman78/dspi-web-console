import { APP_VERSION } from '@/buildInfo';
import { settings } from '@/state';
import { noveauUi } from './noveauUi.svelte';

// First run, or the first launch after a console update, opens ABOUT so the
// version and LATEST CHANGES are the first thing seen; every other launch
// opens TUNE. Call once at boot, after restoreSettings().
export function applyLanding(): void {
  noveauUi.destination = settings.seenVersion === APP_VERSION ? 'tune' : 'about';
  settings.seenVersion = APP_VERSION;
}

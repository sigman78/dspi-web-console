import { mount } from 'svelte';
import './app.css';
import 'virtual:palette.css';
import App from './App.svelte';
import MobileSplash from './components/chrome/MobileSplash.svelte';
import {
  activeSession,
  restoreSettings, startSettingsPersistence,
  presetsDirty, endInitialBoot,
} from './state';
import { bootMockFleet, bootReal, registerNavigatorReconnect } from './runtime';
import { Log, isMobileDevice } from './utils';
import { activeMockProfiles } from './mockProfiles';

const target = document.getElementById('app')!;

// Phones can't host the console (USB cable + desktop layout), so they get a
// permanent "open this on a PC" splash and none of the boot path. Tablets
// deliberately fall through to the regular app.
if (isMobileDevice()) {
  // Lift the desktop layout floor (body min-width) so the splash fits a phone.
  document.body.classList.add('mobile-splash-mode');
  mount(MobileSplash, { target });
} else {
  restoreSettings();
  startSettingsPersistence();

  // See src/devOptions.ts for the full ?mock/?hero/?log convention.
  const mockProfiles = activeMockProfiles();

  // Boot reports its own failures (with errorKind) via reportConnectError. The
  // attempt resolves once the state machine has settled (device synced + snapshot
  // loaded, or no device found), which is exactly when the boot splash may lift.
  const bootAttempt = mockProfiles
    ? bootMockFleet(mockProfiles)
    : bootReal();
  void bootAttempt
    .catch((e) => Log.error('boot', 'boot failed', e))
    .finally(endInitialBoot);

  registerNavigatorReconnect();

  // Warn on unsaved preset changes or unapplied staged edits before unload.
  window.addEventListener('beforeunload', (e) => {
    const s = activeSession();
    if (s && (presetsDirty(s) || s.staging.entries.length > 0)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  mount(App, { target });
}

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
import { bootMock, bootReal, registerNavigatorReconnect } from './runtime';
import { Log, isMobileDevice } from './utils';

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

  const params = new URLSearchParams(location.search);
  const mock = params.get('mock');
  // ?mock=rp2350&fw=115 boots the mock as the released 1.1.5 device (wire V18 --
  // the full leveller-mask + ADAT surface; default is V10 / 1.1.4).
  // ?mock=rp2350&i2s=8 additionally gives it an imaginary 8-channel I2S input
  // (implies the 1.1.5 profile) so the multichannel UI -- incl. the leveller
  // channel masks, which are V18-only -- can be demoed without hardware.
  // ?mock=rp2350&spdif=3 additionally pre-enables SPDIF inputs 2/3 (implies the
  // 1.1.5 profile) so the multi-SPDIF source picker has more than one input to
  // demo without hardware.
  const i2sParam = params.get('i2s');
  const i2sInputChannels = i2sParam != null ? Math.min(8, Math.max(2, Number(i2sParam) | 0)) : undefined;
  const spdifParam = params.get('spdif');
  const spdifInputsEnabled = spdifParam != null ? Math.min(3, Math.max(1, Number(spdifParam) | 0)) : undefined;
  const want115 = params.get('fw') === '115' || (i2sInputChannels != null && i2sInputChannels > 2) || spdifInputsEnabled != null;
  const mockOpts = {
    ...(want115 ? { wireVersion: 18, fwVersion: { major: 1, minor: 1, patch: 5 } } : {}),
    ...(i2sInputChannels != null ? { i2sInputChannels } : {}),
    ...(spdifInputsEnabled != null ? { spdifInputsEnabled } : {}),
    // Demo remote: an armed IR learn self-completes with a fresh NEC code.
    irLearnAutoComplete: true,
  };

  // Boot reports its own failures (with errorKind) via reportConnectError. The
  // attempt resolves once the state machine has settled (device synced + snapshot
  // loaded, or no device found), which is exactly when the boot splash may lift.
  const bootAttempt = (mock === 'rp2040' || mock === 'rp2350')
    ? bootMock(mock, mockOpts)
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

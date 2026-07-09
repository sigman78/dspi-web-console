import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import {
  activeSession,
  restoreSettings, startSettingsPersistence,
  presetsDirty, endInitialBoot,
} from './state';
import { bootMock, bootReal, registerNavigatorReconnect } from './runtime';
import { Log } from './utils';
import { paletteCSS } from './styles/palette';

const paletteStyle = document.createElement('style');
paletteStyle.textContent = paletteCSS();
document.head.appendChild(paletteStyle);

restoreSettings();
startSettingsPersistence();

const params = new URLSearchParams(location.search);
const mock = params.get('mock');
// ?mock=rp2350&fw=115 boots the mock as a V16 / fw 1.1.5 device (default V10 / 1.1.4).
// ?mock=rp2350&i2s=8 additionally boots it with an imaginary 8-channel I2S input
// (implies the V16 / 1.1.5 profile) so the multichannel UI can be demoed.
const i2sParam = params.get('i2s');
const i2sInputChannels = i2sParam != null ? Math.min(8, Math.max(2, Number(i2sParam) | 0)) : undefined;
const wantV16 = params.get('fw') === '115' || (i2sInputChannels != null && i2sInputChannels > 2);
const mockOpts = {
  ...(wantV16 ? { wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 } } : {}),
  ...(i2sInputChannels != null ? { i2sInputChannels } : {}),
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

const app = mount(App, { target: document.getElementById('app')! });
export default app;

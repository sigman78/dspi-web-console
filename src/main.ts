import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import {
  activeSession,
  restoreSettings, startSettingsPersistence,
  presetsDirty,
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
const mockOpts = params.get('fw') === '115'
  ? { wireVersion: 16, fwVersion: { major: 1, minor: 1, patch: 5 } }
  : {};

// Boot reports its own failures (with errorKind) via reportConnectError.
if (mock === 'rp2040' || mock === 'rp2350') {
  void bootMock(mock, mockOpts).catch((e) => Log.error('boot', 'mock boot failed', e));
} else {
  void bootReal().catch((e) => Log.error('boot', 'boot failed', e));
}

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

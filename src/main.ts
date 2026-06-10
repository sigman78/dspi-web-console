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

// Boot reports its own failures (with errorKind) via reportConnectError.
if (mock === 'rp2040' || mock === 'rp2350') {
  void bootMock(mock).catch((e) => Log.error('boot', 'mock boot failed', e));
} else {
  void bootReal().catch((e) => Log.error('boot', 'boot failed', e));
}

registerNavigatorReconnect();

// Warn on unsaved preset changes before unload.
window.addEventListener('beforeunload', (e) => {
  const s = activeSession();
  if (s && presetsDirty(s)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

const app = mount(App, { target: document.getElementById('app')! });
export default app;

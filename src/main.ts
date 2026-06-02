import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import {
  dispatch,
  restoreSettings, startSettingsPersistence,
  presetsDirty,
} from './state';
import { bootMock, bootReal, registerNavigatorReconnect } from './runtime';
import { paletteCSS } from './styles/palette';

const paletteStyle = document.createElement('style');
paletteStyle.textContent = paletteCSS();
document.head.appendChild(paletteStyle);

restoreSettings();
startSettingsPersistence();

const params = new URLSearchParams(location.search);
const mock = params.get('mock');

// Mock interface mode
if (mock === 'rp2040' || mock === 'rp2350') {
  void bootMock(mock).catch((e) => dispatch({ t: 'failed', message: (e as Error).message }));
} else {
  void bootReal().catch((e) => dispatch({ t: 'failed', message: (e as Error).message }));
}

registerNavigatorReconnect();

// Show warning with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (presetsDirty.current) {
    e.preventDefault();
    e.returnValue = '';
  }
});

const app = mount(App, { target: document.getElementById('app')! });
export default app;

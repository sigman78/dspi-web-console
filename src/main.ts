import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import {
  session, setStatus,
  startSettingsPersistence, settings,
  dsp,
  status as statusStore,
  presetsDirty,
} from './state';
import { bootMock, bootReal, registerNavigatorReconnect } from './runtime';
import { paletteCSS } from './styles/palette';

const paletteStyle = document.createElement('style');
paletteStyle.textContent = paletteCSS();
document.head.appendChild(paletteStyle);

startSettingsPersistence();

// Expose state stores on window for direct inspection in DevTools.
// Inspect after Connect:  __dspi.dsp.live?.platform, __dspi.dsp.live?.outputs,
// __dspi.session.status, __dspi.session.lastDeviceInfo?.serial, __dspi.snapshot()
(globalThis as unknown as { __dspi: unknown }).__dspi = {
  dsp, status: statusStore, settings, session,
  snapshot() {
    const snapshot = dsp.live;
    return {
      session: { ...session },
      platform: snapshot?.platform ? { ...snapshot.platform } : null,
      formatVersion: snapshot?.formatVersion ?? 0,
      bypass: snapshot?.bypass ?? false,
      masterVolumeDb: snapshot?.masterVolumeDb ?? 0,
      masterPreampDb: snapshot?.masterPreampDb ?? 0,
      inputPreampDb: snapshot ? [...snapshot.inputPreampDb] : [0, 0],
      channelNames: snapshot?.channels.map((c) => c.name) ?? [],
      outputs: snapshot?.outputs.map((o) => ({ ...o })) ?? [],
      routes: snapshot?.routes.map((route) => ({ ...route })) ?? [],
      i2s: snapshot?.i2s ? { ...snapshot.i2s, outputSlotTypes: [...snapshot.i2s.outputSlotTypes] } : null,
      muted: settings.soft.muted,
      mutedFromDb: settings.soft.mutedFromDb,
    };
  },
};

const params = new URLSearchParams(location.search);
const mock = params.get('mock');

if (mock === 'rp2040' || mock === 'rp2350') {
  void bootMock(mock).catch((e) => setStatus('error', (e as Error).message));
} else {
  void bootReal().catch((e) => setStatus('error', (e as Error).message));
}

registerNavigatorReconnect();

window.addEventListener('beforeunload', (e) => {
  if (presetsDirty.current) {
    // Browsers ignore custom strings since ~2017, but the handler
    // calling preventDefault + setting returnValue triggers the
    // generic "leave site?" dialog.
    e.preventDefault();
    e.returnValue = '';
  }
});

const app = mount(App, { target: document.getElementById('app')! });
export default app;

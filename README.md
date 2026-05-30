# DSPi Console Web

A browser-based configurator for the [Weeb Labs DSPi](https://github.com/WeebLabs/DSPi) — no installer, no driver stack, just open a tab and tune.

Built on WebUSB. Runs entirely client-side as a static SPA (Svelte 5 + TypeScript, bundled with Vite).

[> Demo <](https://sigman78.github.io/dspi-web-console/)

## Features

- **EQ** — per-channel parametric editing with 5 filter types and N bands, live Bode plot, copy bands between channels, output trim.
- **Mixer** — 2×N matrix routing with per-cell enable/invert/gain, plus per-output enable, mute, gain, and delay.
- **Master** — volume, mute, master preamp, per-input preamp.
- **Processing** — loudness, crossfeed, leveller.
- **Telemetry** — clock, voltage, sample rate, temperature, error counters, buffer stats.

## Requirements

- A Chromium-based browser (Chrome, Edge, Brave, Opera). WebUSB is not available in Firefox or Safari.
- HTTPS, or `localhost` for development. WebUSB requires a secure context.
- **Windows users:** bind the DSPi's vendor interface (interface 2) to **WinUSB** via [Zadig](https://zadig.akeo.ie/) if your device was previously paired with libusb-win32. Close any other app holding the interface — only one process can claim it at a time.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Then open the URL in Chrome/Edge, click **Connect**, and pick your DSPi.

### No hardware? Use the mock device.

Append a `?mock=` flag to boot against a wire-faithful synthesized device — useful for trying out the UI:

```
http://localhost:5173/?mock=rp2040
http://localhost:5173/?mock=rp2350
```

## Build & test

```bash
npm run build        # static build → dist/
npm run preview      # serve the production build locally

npm run test         # unit + integration (no hardware required)
npm run test:hil     # hardware-in-the-loop (requires a real device)
npm run check        # TypeScript + svelte-check
npm run lint
```

HIL tests talk to the device over libusb, so unplug any browser tab holding the interface before running them.

### Git hooks

[husky](https://typicode.github.io/husky/) is wired up via the `prepare` script, so hooks install automatically on `npm install`. No extra setup.

- **pre-commit** — runs `eslint --fix` on staged `.ts`/`.svelte` files (via lint-staged).
- **pre-push** — runs the full gate: `npm run check && npm run test && npm run build`.

Bypass with `--no-verify` if you really need to.

## Mock vs hardware

The mock transport (`?mock=*`, also used in tests) synthesises a wire-faithful bulk packet, echoes writes back to readers, and produces deterministic telemetry. Almost every contract that holds against real hardware also holds in mock, so you can iterate on UI without plugging in a device.

## Debugging: wire protocol monitor

Append `?debug` to log every DSPi wire message exchanged with the device to the
browser console. It works against real hardware and the mock alike, so combine
it with `?mock=`:

```
http://localhost:5173/?mock=rp2350&debug
```

On connect you get a short banner, then one line per control transfer,
notification, and bulk read — best-effort decoded:

```
[dspi:wire] * device connected - RP2350 (platformId 1)
[dspi:wire]   firmware 1.0.0 | wire V6 (supported)
[dspi:wire]   serial "MOCK-RP2350-0001" | 11 ch / 9 out
[dspi:wire]   sections i2s,leveller,preamp,masterVolume | notify off
[dspi:wire] <- GetSerial "MOCK-RP2350-0001"
[dspi:wire] <> GetAllParams (bulk) v6 2896 B
[dspi:wire] -> SetOutputGain w=0x2 3.50
[dspi:wire] <~ notify presetLoaded seq=3 slot=2
```

Markers: `->` host write, `<-` device response, `<~` device notification,
`<>` bulk transfer.

The continuous `GetStatus` / `GetBufferStats` telemetry polls are logged at
**debug** (DevTools "Verbose") level, so they stay hidden by default and don't
bury the interesting traffic — switch the console level filter to **Verbose** to
see them. `?log=0` silences everything, including the monitor.

## License

MIT

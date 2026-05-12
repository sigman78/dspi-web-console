# DSPi Console Web

A browser-based configurator for the [DSPi USB DSP board](https://dspi.dev) — no installer, no driver stack, just open a tab and tune.

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

## License

MIT

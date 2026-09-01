# DSPi Web Console

A browser-based configurator for the [Weeb Labs DSPi](https://github.com/WeebLabs/DSPi)

Built on WebUSB. Runs entirely client-side as a static SPA (Svelte 5 + TypeScript, bundled with Vite).

[> Launch App <](https://dspi-ctrl.fyi) | [> Demo (w/o device) <](https://dspi-ctrl.fyi/?mock)

> **[dspi-ctrl.fyi](https://dspi-ctrl.fyi)** is the stable release. The rolling test build (latest `master`) is on [GitHub Pages](https://sigman78.github.io/dspi-web-console/).

[![CI](https://github.com/sigman78/dspi-web-console/actions/workflows/ci.yml/badge.svg)](https://github.com/sigman78/dspi-web-console/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/sigman78/dspi-web-console/actions/workflows/deploy.yml/badge.svg)](https://github.com/sigman78/dspi-web-console/actions/workflows/deploy.yml)

## HW/FW Compatibility status

- **Minimal fw 1.1.4 (V10)** — S/PDIF input, LG Sound Sync, user volume, DAC hardware mute, EQ with per-band bypass, presets, notifications, firmware update from the app. Fully supported; it just doesn't show the 1.1.5 features below.
- **Current 1.1.5 (V16–V26)** adds: up to 8-in / 9-out on RP2350, multichannel I2S input, up to three selectable S/PDIF inputs, per-output crossover filters, first-order and Linkwitz Transform EQ, UART/I2C external control interfaces, Control Surfaces (physical controls/LEDs on spare GPIOs) with IR remote learn, I2S slave-clock mode, channel masks for the volume leveller / loudness / crossfeed, psychoacoustic bass enhancement, a stereo upmixer (Centre/Ls/Rs derived from a stereo source, RP2350), and pin reset-to-default. Every surface is gated per feature on the device's capabilities and the exact wire version that carries it, so older firmware simply doesn't show what it can't do.
- Firmware newer than the console knows (wire > V26) connects best-effort, reading only the sections it recognizes.

## Requirements

- A Chromium-based browser (Chrome, Edge, Brave, Opera).
- **Windows users:** bind the DSPi's vendor interface (interface 2) to **WinUSB** via [Zadig](https://zadig.akeo.ie/) if your device was previously paired with libusb-win32. Close any other app holding the interface — only one process can claim it at a time.
- **Linux users:** the browser needs a udev rule to open the DSPi. The connect screen has a hint with a one-liner (`curl … /setup-linux.sh | sh`) that installs it; or drop [`70-dspi.rules`](public/70-dspi.rules) into `/etc/udev/rules.d/` yourself, run `udevadm control --reload`, and replug.
- Platform-specific troubleshooting instructions are available at [Wiki](https://github.com/sigman78/dspi-web-console/wiki) pages 

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Then open the URL in Chrome/Edge, click **Connect**, and pick your DSPi.

**Multiple devices:** manage them from the sidebar's **DEVICES** list — **+** adopts another unit, clicking a row switches to it (full resync). Inactive units stay claimed; only the active one is polled.

### No hardware? Use the mock device.

Append a `?mock` flag to boot against a wire-faithful synthesized device — useful for trying out the UI. It takes one or more comma-separated profile tokens, plus an optional `&chip=` hardware flavor:

```
http://localhost:5173/?mock                     # newest wire / fw 1.1.5 (8-in/9-out, crossover, control interfaces + surfaces)
http://localhost:5173/?mock=legacy              # legacy 1.1.4 / V10 surface
http://localhost:5173/?mock=multi               # newest surface + 8ch I2S input + 3 S/PDIF inputs (multichannel demo)
http://localhost:5173/?mock=v18                 # exact wire version 18, for testing per-version feature gates
http://localhost:5173/?mock&chip=rp2040         # rp2040 flavor (5 outputs), combinable with any profile
http://localhost:5173/?mock=rp2040,rp2350       # two-device fleet — one mock per entry, exercises the DEVICES switcher
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

HIL tests need exclusive usb access, so close all browser tab holding the interface before running them.

### Git hooks

Use `npm run prepare` script to initialise hooks after `npm install`.

- **pre-commit** — runs `eslint --fix` on staged `.ts`/`.svelte` files (via lint-staged).
- **pre-push** — runs the full gate: `npm run check && npm run test && npm run build`.

## Mock vs hardware

The mock transport (`?mock=*`, also used in tests) synthesises a wire-faithful bulk packet, echoes writes back to readers, and produces deterministic telemetry. Almost every contract that holds against real hardware also holds in mock, so you can iterate on UI without plugging in a device.

## Usb wire monitoring

Append `?log=wire` to log every wire message to the browser console. High-volume telemetry polls go to the **Verbose** level (hidden by default)

## Contributing & releases

Branching model, commit conventions, and the (automated) release flow live in
[CONTRIBUTING.md](./CONTRIBUTING.md). Shipped changes are tracked in
[CHANGELOG.md](./CHANGELOG.md).

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

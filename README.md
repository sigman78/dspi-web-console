# DSPi Console Web

A browser-based configurator for the [Weeb Labs DSPi](https://github.com/WeebLabs/DSPi) — no installer, no driver stack, just open a tab and tune.

Built on WebUSB. Runs entirely client-side as a static SPA (Svelte 5 + TypeScript, bundled with Vite).

[> Launch <](https://dspi-ctrl.fyi) | [> Demo (w/o device) <](https://dspi-ctrl.fyi/?mock=rp2350)

> **[dspi-ctrl.fyi](https://dspi-ctrl.fyi)** is the stable release. The rolling test build (latest `master`) is on [GitHub Pages](https://sigman78.github.io/dspi-web-console/).

[![CI](https://github.com/sigman78/dspi-web-console/actions/workflows/ci.yml/badge.svg)](https://github.com/sigman78/dspi-web-console/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/sigman78/dspi-web-console/actions/workflows/deploy.yml/badge.svg)](https://github.com/sigman78/dspi-web-console/actions/workflows/deploy.yml)

## HW/FW Compatibility status

- **Requires firmware 1.1.4+.** Two channel-model generations are fully supported: **1.1.4** (wire V10) and **1.1.5** (wire V16–V18, unified channel model — V16/V17/V18 share one channel model and differ only by additive sections). Older firmware (≤ 1.1.3) and in-development intermediates (wire 11–15) are detected at connect and rejected with a firmware-update notice — flash a current [DSPi release](https://github.com/WeebLabs/DSPi) via the UF2 bootloader (hold BOOTSEL while plugging in).
- Firmware newer than the console knows (wire > V18) connects best-effort, reading only the sections it recognizes.
- **1.1.4 (V10)** surface: S/PDIF input + RX status, LG Sound Sync, user volume/mute, DAC hardware mute, per-band EQ bypass, Notch/Allpass filters, output-config persistence modes (with-preset / independent), buffer stats, device notifications, and an UPDATE FIRMWARE button that reboots into the bootloader.
- **1.1.5 (V16–V18)** adds: up to 8-in / 9-out on RP2350, I2S multichannel input, per-output crossover filters, first-order shelf/allpass EQ, UART/I2C external control interfaces, Control Surfaces (physical controls/LEDs on spare GPIOs), live active-input-count reporting, and — on the V18 release — per-input volume-leveller channel masks. Every 1.1.5 surface is gated on device capabilities, per feature and on the exact wire version where it matters (e.g. the leveller masks need V18), so older firmware simply doesn't show what it can't do.
- Both USB identities are recognized: `2E8B:FEAA` (fw ≥ 1.1.4) and the legacy `2E8A:FEAA` (≤ 1.1.3, upgrade-prompt only).
- RP2350 tested end-to-end; RP2040 verified on MCU hardware only (no audio out).

## Requirements

- A Chromium-based browser (Chrome, Edge, Brave, Opera). WebUSB is not available in Firefox or Safari.
- HTTPS, or `localhost` for development. WebUSB requires a secure context.
- **Windows users:** bind the DSPi's vendor interface (interface 2) to **WinUSB** via [Zadig](https://zadig.akeo.ie/) if your device was previously paired with libusb-win32. Close any other app holding the interface — only one process can claim it at a time.
- **Linux users:** the browser needs a udev rule to open the DSPi. The connect screen has a **"LINUX? ONE-TIME USB SETUP"** panel with a one-liner (`curl … /setup-linux.sh | sh`) that installs it; or drop [`70-dspi.rules`](public/70-dspi.rules) into `/etc/udev/rules.d/` yourself, run `udevadm control --reload`, and replug.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Then open the URL in Chrome/Edge, click **Connect**, and pick your DSPi.

### No hardware? Use the mock device.

Append a `?mock=` flag to boot against a wire-faithful synthesized device — useful for trying out the UI:

```
http://localhost:5173/?mock=rp2040          # V10 / fw 1.1.4
http://localhost:5173/?mock=rp2350          # V10 / fw 1.1.4
http://localhost:5173/?mock=rp2350&fw=115   # V18 / fw 1.1.5 (8-in/9-out, crossover, control interfaces + surfaces)
http://localhost:5173/?mock=rp2350&i2s=8    # V18 / fw 1.1.5 with an 8-channel I2S input (multichannel UI + leveller masks)
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

Bypass with `--no-verify` if you really need to.

## Mock vs hardware

The mock transport (`?mock=*`, also used in tests) synthesises a wire-faithful bulk packet, echoes writes back to readers, and produces deterministic telemetry. Almost every contract that holds against real hardware also holds in mock, so you can iterate on UI without plugging in a device.

## Usb wire monitoring

Append `?debug` to log every wire message to the browser console. High-volume telemetry polls go to the **Verbose** level (hidden by default)

## Contributing & releases

Branching model, commit conventions, and the (automated) release flow live in
[CONTRIBUTING.md](./CONTRIBUTING.md). Shipped changes are tracked in
[CHANGELOG.md](./CHANGELOG.md).

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

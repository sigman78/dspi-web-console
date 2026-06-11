# DSPi Console Web

A browser-based configurator for the [Weeb Labs DSPi](https://github.com/WeebLabs/DSPi) — no installer, no driver stack, just open a tab and tune.

Built on WebUSB. Runs entirely client-side as a static SPA (Svelte 5 + TypeScript, bundled with Vite).

[> Launch <](https://sigman78.github.io/dspi-web-console/) | [> Demo (w/o device) <](https://sigman78.github.io/dspi-web-console/?mock=rp2350)

[![Deploy to GitHub Pages](https://github.com/sigman78/dspi-web-console/actions/workflows/deploy.yml/badge.svg)](https://github.com/sigman78/dspi-web-console/actions/workflows/deploy.yml)

## HW/FW Compatibility status

- **Requires firmware 1.1.4+** (wire format V10). Older firmware (≤ 1.1.3) is detected at connect and rejected with a firmware-update notice — flash a current [DSPi release](https://github.com/WeebLabs/DSPi) via the UF2 bootloader (hold BOOTSEL while plugging in).
- Firmware newer than the console knows (wire > V10) connects best-effort.
- The full 1.1.4 surface is wired: S/PDIF input + RX status, LG Sound Sync, user volume/mute, DAC hardware mute, per-band EQ bypass, Notch/Allpass filters, output-config persistence modes (with-preset / independent), buffer stats, device notifications, and an UPDATE FIRMWARE button that reboots into the bootloader.
- Both USB identities are recognized: `2E8B:FEAA` (fw ≥ 1.1.4) and the legacy `2E8A:FEAA` (≤ 1.1.3, upgrade-prompt only).
- RP2350 tested end-to-end; RP2040 verified on MCU hardware only (no audio out).

## Requirements

- A Chromium-based browser (Chrome, Edge, Brave, Opera). WebUSB is not available in Firefox or Safari.
- HTTPS, or `localhost` for development. WebUSB requires a secure context.
- **Windows users:** bind the DSPi's vendor interface (interface 2) to **WinUSB** via [Zadig](https://zadig.akeo.ie/) if your device was previously paired with libusb-win32. Close any other app holding the interface — only one process can claim it at a time.
- **Linux users:** browser needs usb device access permissions [properly configured](https://www.reddit.com/r/Keychron/comments/12f3gat/useviaapp_in_linux_ie_via_support_useful_for/).

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

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

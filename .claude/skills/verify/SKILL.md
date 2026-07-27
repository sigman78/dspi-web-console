---
name: verify
description: Launch and drive the DSPi web console to verify changes end-to-end in mock-device mode (no hardware needed). Use when verifying UI/protocol changes at the running-app surface.
---

# Verifying the DSPi web console

## Launch

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -WorkingDirectory "D:\non-esp\dspi-web-console" -WindowStyle Hidden
# vite serves http://localhost:5173/ within ~3 s
```

IMPORTANT (Windows): a piped background `npm run dev` leaks an orphaned vite.
Start detached as above; on teardown kill BOTH the npm-cli node process and the
vite node child, then confirm nothing matching `vite` remains:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'vite|npm-cli.js" run dev' }
Stop-Process -Id <ids> -Force -Confirm:$false
```

## Mock device modes (no hardware)

- `?mock` — newest surface (fw 1.1.5 / newest wire version — see `src/mockProfiles.ts`)
- `?mock=legacy` — legacy V10 / fw 1.1.4 surface (1.1.5-only UI must hide)
- `?mock=multi` — multichannel demo: 8-channel I2S input + 3 selectable S/PDIF inputs
- `?mock=v<N>` — exact bulk/wire format N, for testing per-wire-version feature gates
- `&chip=rp2040` — RP2040 flavor (5 outputs, fewer pairs), combinable with any profile

Mock state is in-memory: it survives tab switches (mirror round-trip — good for
verifying writes actually hit the device) but resets on full page reload. Hash-only
navigation (`#processing`) does NOT reload.

## Drive

Playwright MCP tools work well. Tabs: 01 OVERVIEW / 02 EQUALIZER / 03 MIXER /
04 PROCESSING / 05 PRESETS / 06 SYSTEM / 07 CONTROL (07 hidden on V10).
Processing panels: PR.01 CROSSFEED, PR.02 LOUDNESS, PR.03 LEVELLER,
PR.04 PSYBASS, PR.05 STEREO UPMIXER (PR.04/PR.05 are newest-wire + RP2350
gated — hidden on legacy and rp2040 profiles).
System panels include SY.08 I2S CLOCK, SY.11 INPUT CONFIG, SY.12 BUFFER STATS.

Gotchas:
- Effect controls are disabled until the effect's enable switch is on AND connected.
- Editing anything marks the preset dirty → `beforeunload` fires a blocking dialog
  on navigation away; Playwright auto-dismisses it but the navigate call reports a
  modal state. The dialog appearing is itself evidence dirty-tracking works.
- Verify a write round-tripped (not just optimistic UI): switch to another tab and
  back — the remount re-reads the mirror.
- To check dirty state: PRESETS tab shows a "dirty" / "unsaved changes" badge on
  the active slot.

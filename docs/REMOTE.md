# Remote control

Drive a DSPi plugged into one computer from a console on another computer on
the same local network.

- **Host (A)**: the computer the DSPi is plugged into, running the console in
  Chrome. It shares the device.
- **Guest (B)**: any other computer on the same network, running the console
  in Chrome. It takes control.

While B is in control, A shows only an "under remote control" screen with
**Cancel**. B gets the full console, as if the device were plugged into it.

## Using it

1. On A, click the **Share** icon on the device row in the DEVICES list. A
   six-character code appears (for example `BWA-AVG`).
2. On B, click **Connect to a remote device** on the start screen, or the link
   icon in the DEVICES list, and type the code. A link copied from A's Share
   popover (`?join=<code>`) does the same.
3. A asks *"<name> wants control"*. Click **Allow**.

B switches to the device and shows it with a link icon and `(remote)` in its
DEVICES list. B's
name (for example `Windows · Chrome · calm otter`) is made up from the
platform, the browser and a random name kept by that browser. Nobody types it.

### Ending and coming back

- **Cancel** on A takes the device back. Sharing stays on, so B can use
  **Reconnect** later, and A asks Allow again.
- **Stop sharing** on A takes the device back and closes the room. B's
  Reconnect stops working; a new share gives a new code.
- Closing B's tab, or B losing the network, gives the device back to A within
  about 15 seconds.
- B can **Reconnect** without a new code for up to 24 hours while A keeps
  sharing. A does not ask Allow for a reconnect, unless A pressed Cancel since
  the last Allow.

### What the codes do

- A code works for one join. After that, or after 10 minutes unused, it is
  replaced; A's popover always shows the current one. **New code** replaces it
  by hand.
- **Deny** refuses B and replaces the code.
- While B is in control, other joins are refused.

### What B cannot do

A refuses two commands from B: **enter bootloader** (firmware update) and
**factory reset**. Do those on A, with the device taken back.

## Requirements and limits

- Both computers run a Chromium browser and are on the **same local network**.
  The console connects them directly (WebRTC, host candidates only); there is
  no internet relay for the device traffic. Guest Wi-Fi with client isolation,
  or two different networks, will not connect.
- A must stay open. A hidden tab works; a closed tab, a sleeping computer, or
  Chrome discarding the tab (Memory Saver) ends the session. Keep A's console
  in its own window.
- One guest at a time per device. A cannot switch or add devices while it is
  sharing.

## How it works

```
 B (guest console)                  relay (Worker + DO)                A (host console) ── USB ── DSPi
 RemoteTransport  ◄──── WebRTC DataChannel, end-to-end encrypted ────►  UsbProxy
        └──── pairing only: code, Allow, SDP offer/answer ───┴──── WebSocket ────┘
```

- **Pairing** goes through a small relay on the console's own domain (`/room`):
  a Cloudflare Worker with three Durable Objects (`Room`, `CodePtr`,
  `IpLimiter`, code in `worker/`). The relay sees the code, the guest's name
  and the WebRTC session descriptions (which include LAN addresses and
  encryption fingerprints). It never sees device traffic.
- **Device traffic** is a WebRTC DataChannel straight between the two
  browsers. B's `RemoteTransport` (`src/transport/remote/`) sends each USB
  control transfer as a small binary frame. A's `UsbProxy`
  (`src/runtime/remote/UsbProxy.ts`) runs them one at a time on the real
  device and sends the answers back. Device notifications have their own lane.
- **Lending** (`src/runtime/remote/lease.ts`): before handing over, A flushes
  pending writes and stops its own polling, so only B talks to the device.
  When the device comes back, A reads its full state again, since B may have
  changed anything.
- **Allowlist** (`src/runtime/remote/allowlist.ts`): A accepts only commands
  the console itself knows, and always refuses bootloader and factory reset.

### Relay security

- Requests are accepted only from origins listed in `ALLOWED_ORIGINS`.
- 20 joins per minute per IP address (IPv6 by /64), plus per-room caps on code
  changes and handshake messages.
- The room id and secrets are random; the six-character code is only a
  short-lived pointer to the room. The guest's resume token is issued only
  after A clicks Allow.
- The relay is trusted to pass the right encryption fingerprints. It is run by
  the console's owner, so this is accepted.

## Enabling it in production

The feature is off unless both of these are set. Without them the site behaves
exactly as before: no Share or Connect controls, and the relay answers `403`.

1. **Merge and release.** Workers Builds deploys the `release` branch:
   `npm run build`, then `dist/` as static assets plus the Worker from
   `wrangler.jsonc`. The first deploy creates the Durable Objects (migration
   `v1`, SQLite storage, works on the Free plan).
2. **Worker variable** (Cloudflare dashboard → Workers → `dspi-console` →
   Settings → Variables): `ALLOWED_ORIGINS` = comma-separated origins that may
   use the relay, for example `https://dspi-ctrl.fyi`. `keep_vars` in
   `wrangler.jsonc` keeps it across deploys.
3. **Build variable** (same Worker → Settings → Build → Variables):
   `VITE_REMOTE_RELAY=/room`. It is read at build time, so trigger a new build
   after setting it.

Recommended: a WAF rate-limiting rule (Security → WAF → Rate limiting rules;
the Free plan includes one) matching URI path starting with `/room`, counting
by IP, for example 20 requests per 10 seconds, action Block. The Worker has its
own per-IP limit, but every refused request still counts against the Free
plan's 100k Worker requests a day; a WAF rule drops them before the Worker
runs. One normal pairing costs a handful of requests.

With a Worker script in front of the assets, requests for missing files that
are not page loads (scanners, missing source maps) now reach the Worker and get
a plain `404`. Page loads still get the app.

The GitHub Pages test build stays without remote control: the relay has no
CORS, so it only serves pages from its own domain.

## Developing

```bash
npm run dev:worker   # relay on http://localhost:8787, accepts http://localhost:5173
npm run dev          # the dev server proxies /room to it; the relay is on by default in dev
```

Test with two tabs: A at `http://localhost:5173/?mock`, B at
`http://localhost:5173/`. On another port, start the relay with
`npx wrangler dev --port 8787 --var ALLOWED_ORIGINS:http://localhost:<port>`.

`?remote=manual` shows a developer panel for pairing without the relay, by
pasting the offer and answer between tabs.

Tests: `npm run test` covers the tunnel, proxy and lease; `npm run test:worker`
and `npm run check:worker` cover the relay. CI and the pre-push hook run all of
them.

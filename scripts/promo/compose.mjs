// Lays the captured screenshots out into the README promo sheet and the OG card.
// Usage: node scripts/promo/compose.mjs <shotsDir>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const shots = path.resolve(process.argv[2] ?? 'promo-shots');
const repo = path.resolve(import.meta.dirname, '../..');
const img = (name) => pathToFileURL(path.join(shots, `${name}.png`)).href;
const font = (pkg, file) => pathToFileURL(path.join(repo, 'node_modules/@fontsource', pkg, 'files', file)).href;
const logo = fs.readFileSync(path.join(repo, 'public/app.svg'), 'utf8');

const base = `
@font-face { font-family: Plex; font-weight: 400; src: url(${font('ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2')}); }
@font-face { font-family: Plex; font-weight: 500; src: url(${font('ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff2')}); }
@font-face { font-family: Plex; font-weight: 600; src: url(${font('ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff2')}); }
@font-face { font-family: Plex; font-weight: 700; src: url(${font('ibm-plex-sans', 'ibm-plex-sans-latin-700-normal.woff2')}); }
@font-face { font-family: Mono; font-weight: 500; src: url(${font('jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff2')}); }
:root {
  --bg: oklch(10% 0.01 250);
  --text: oklch(95% 0.005 240);
  --dim: color-mix(in oklab, var(--text) 62%, transparent);
  --faint: color-mix(in oklab, var(--text) 40%, transparent);
  --accent: oklch(72% 0.13 265);
  --pink: oklch(78% 0.14 340);
  --line: color-mix(in oklab, var(--text) 12%, transparent);
}
* { box-sizing: border-box; margin: 0; }
body {
  font-family: Plex, sans-serif; color: var(--text);
  background:
    radial-gradient(1200px 700px at 78% -10%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%),
    radial-gradient(900px 600px at 0% 105%, color-mix(in oklab, var(--pink) 10%, transparent), transparent 70%),
    var(--bg);
}
.logo svg { width: 100%; height: 100%; display: block; }
.shot { display: block; width: 100%; border-radius: 10px; border: 1px solid var(--line);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(0 0 0 / 0.4); }
.mono { font-family: Mono, monospace; letter-spacing: 0.06em; }
`;

// Tiles skip the icon rail and channel list so the panel itself reads larger.
const SKIP = 0.163;
const tile = (name, title, text, crop = 0.7) => `
<figure class="tile">
  <div class="frame" style="aspect-ratio: ${(16 * (1 - SKIP)).toFixed(2)} / ${(9 * crop).toFixed(2)}"><img class="shot" style="width: ${(100 / (1 - SKIP)).toFixed(2)}%; margin-left: -${(100 * SKIP / (1 - SKIP)).toFixed(2)}%" src="${img(name)}"></div>
  <figcaption><b>${title}</b> ${text}</figcaption>
</figure>`;

const promo = `<!doctype html><meta charset="utf-8"><style>${base}
body { width: 1600px; padding: 64px 72px 56px; }
header { display: flex; align-items: center; gap: 22px; }
.logo { width: 64px; height: 64px; }
h1 { font-size: 46px; font-weight: 700; letter-spacing: -0.01em; line-height: 1; }
h1 span { color: var(--accent); }
.tag { margin-top: 18px; font-size: 22px; color: var(--dim); max-width: 1100px; line-height: 1.45; }
.chips { margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap; }
.chips span { font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim); }
.hero { margin-top: 40px; }
.hero figcaption, .tile figcaption { margin-top: 14px; font-size: 17px; line-height: 1.5; color: var(--dim); }
figcaption b { color: var(--text); font-weight: 600; margin-right: 6px; }
.grid { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 36px 40px; }
.frame { overflow: hidden; border-radius: 10px; }
.frame .shot { border-radius: 10px 10px 0 0; }
.tile .frame { box-shadow: 0 20px 50px rgb(0 0 0 / 0.5); border: 1px solid var(--line); }
.tile .frame .shot { border: 0; box-shadow: none; }
footer { margin-top: 44px; padding-top: 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; font-size: 15px; color: var(--faint); }
</style>
<header><div class="logo">${logo}</div><h1>DSPi <span>Web Console</span></h1></header>
<p class="tag">The control room for the Weeb Labs DSPi audio board, right in the browser. Tune, route and wire up your system over USB with nothing to install.</p>
<div class="chips mono"><span>WEBUSB</span><span>NO DRIVERS</span><span>RP2040 · RP2350</span><span>UP TO 8 IN · 9 OUT</span><span>MULTI-DEVICE</span><span>DEMO MODE</span></div>
<figure class="hero"><img class="shot" src="${img('room')}">
  <figcaption><b>Room.</b> What the system is playing right now, read live from the board's spectrum analyser, with presets one click away.</figcaption></figure>
<div class="grid">
${tile('tune', 'Tune.', 'Parametric EQ, crossovers, trim, delay and a lookahead limiter for every output, drawn as one combined response curve.')}
${tile('program', 'Program.', 'The routing matrix and the processing chain in firmware order: leveller, upmixer, crossfeed, subharmonic synth, bass enhancement, loudness.')}
${tile('setup-outputs', 'Setup.', 'Output types, I2S and ADAT clocks, inputs, and a pin map that shows which feature holds each GPIO.')}
${tile('control', 'Control.', 'Wire knobs, buttons, LEDs, IR remotes and small displays to spare GPIOs and bind them to device functions, no firmware edits.')}
</div>
<footer><span>Chrome · Edge · Brave · Opera</span><span>Runs entirely in your browser</span></footer>`;

const og = `<!doctype html><meta charset="utf-8"><style>${base}
body { width: 1200px; height: 630px; overflow: hidden; position: relative;
  background:
    radial-gradient(700px 500px at 85% 20%, color-mix(in oklab, var(--accent) 26%, transparent), transparent 70%),
    radial-gradient(600px 400px at 10% 110%, color-mix(in oklab, var(--pink) 14%, transparent), transparent 70%),
    var(--bg); }
.copy { position: absolute; left: 64px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
.logo { width: 76px; height: 76px; margin-bottom: 30px; }
h1 { font-size: 64px; font-weight: 700; line-height: 1.02; letter-spacing: -0.015em; }
h1 span { display: block; color: var(--accent); }
p { margin-top: 22px; font-size: 24px; line-height: 1.4; color: var(--dim); }
.mono { margin-top: 26px; font-size: 14px; color: var(--faint); }
.stage { position: absolute; left: 560px; top: 70px; width: 980px; perspective: 1600px; }
.stage .back { width: 900px; transform: rotateY(-16deg) rotateX(4deg); transform-origin: left center; }
.stage .front { position: absolute; left: 150px; top: 250px; width: 620px; transform: rotateY(-16deg) rotateX(4deg); transform-origin: left center; }
.stage .front .crop { aspect-ratio: 16 / 7; overflow: hidden; border-radius: 10px; border: 1px solid var(--line); box-shadow: 0 30px 70px rgb(0 0 0 / 0.7); }
.stage .front .shot { border: 0; box-shadow: none; }
</style>
<div class="copy">
  <div class="logo">${logo}</div>
  <h1>DSPi<span>Web Console</span></h1>
  <p>Tune, route and wire up your DSPi right from the browser.</p>
  <div class="mono">WEBUSB · NO INSTALL · NO DRIVERS</div>
</div>
<div class="stage">
  <img class="shot back" src="${img('room')}">
  <div class="front"><div class="crop"><img class="shot" src="${img('tune')}"></div></div>
</div>`;

const banner = `<!doctype html><meta charset="utf-8"><style>${base}
body { width: 1280px; height: 400px; overflow: hidden; position: relative;
  background:
    radial-gradient(640px 420px at 82% 10%, color-mix(in oklab, var(--accent) 24%, transparent), transparent 70%),
    radial-gradient(520px 320px at 0% 120%, color-mix(in oklab, var(--pink) 12%, transparent), transparent 70%),
    var(--bg); }
.copy { position: absolute; left: 56px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
.head { display: flex; align-items: center; gap: 18px; }
.logo { width: 58px; height: 58px; flex: none; }
h1 { font-size: 46px; font-weight: 700; line-height: 1; letter-spacing: -0.01em; white-space: nowrap; }
h1 span { color: var(--accent); }
p { margin-top: 20px; font-size: 20px; line-height: 1.45; color: var(--dim); }
.mono { margin-top: 20px; font-size: 13px; color: var(--faint); }
.stage { position: absolute; left: 560px; top: 34px; width: 900px; perspective: 1500px; }
.stage .back { width: 760px; transform: rotateY(-14deg) rotateX(3deg); transform-origin: left center; }
.stage .front { position: absolute; left: 190px; top: 170px; width: 470px; transform: rotateY(-14deg) rotateX(3deg); transform-origin: left center; }
.stage .front .crop { aspect-ratio: 16 / 7; overflow: hidden; border-radius: 8px; border: 1px solid var(--line); box-shadow: 0 24px 60px rgb(0 0 0 / 0.7); }
.stage .front .shot { border: 0; box-shadow: none; }
</style>
<div class="copy">
  <div class="head"><div class="logo">${logo}</div><h1>DSPi <span>Web Console</span></h1></div>
  <p>Tune, route and wire up your Weeb Labs DSPi right from the browser.</p>
  <div class="mono">WEBUSB · NO INSTALL · NO DRIVERS · DEMO MODE</div>
</div>
<div class="stage">
  <img class="shot back" src="${img('room')}">
  <div class="front"><div class="crop"><img class="shot" src="${img('tune')}"></div></div>
</div>`;

const browser = await chromium.launch({ channel: 'msedge' });
async function render(html, file, viewport, scale, type, fullPage) {
  const htmlPath = path.join(shots, `_${path.parse(file).name}.html`);
  fs.writeFileSync(htmlPath, html);
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(shots, file), fullPage, type, ...(type === 'jpeg' ? { quality: 86 } : {}) });
  await page.close();
}
await render(promo, 'promo.jpg', { width: 1600, height: 1000 }, 1.25, 'jpeg', true);
await render(og, 'og.png', { width: 1200, height: 630 }, 1, 'png', false);
await render(banner, 'banner.jpg', { width: 1280, height: 400 }, 1.5, 'jpeg', false);
await browser.close();

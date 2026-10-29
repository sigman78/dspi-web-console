// Captures promo screenshots from the mock device with a staged demo setup.
// Usage: node scripts/promo/shots.mjs <outDir>
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? 'promo-shots';
const PORT = 5179;
const URL = `http://localhost:${PORT}/?mock`;
fs.mkdirSync(out, { recursive: true });

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const killVite = () => { try { execSync(`taskkill /T /F /PID ${vite.pid}`, { stdio: 'ignore' }); } catch { /* already gone */ } };
process.on('exit', killVite);

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(URL)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('vite did not start');
}

try {
  await waitUp();
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await page.goto(URL, { timeout: 120_000 });
  const stage = fs.readFileSync(path.join(import.meta.dirname, 'stage.js'), 'utf8');
  console.log(await page.evaluate(`(${stage.replace(/^\/\/.*\n/gm, '')})()`));

  const go = async (n) => { await page.keyboard.press(`Alt+Digit${n}`); await page.waitForTimeout(1500); };
  const shot = async (name, settle = 1000) => { await page.waitForTimeout(settle); await page.screenshot({ path: path.join(out, `${name}.png`) }); };
  const tab = (label) => page.getByRole('tab', { name: label }).or(page.getByRole('button', { name: label, exact: true })).first().click();

  await go(2); await shot('tune');
  await go(3); await shot('program');
  await go(4); await shot('setup-inputs');
  await tab('OUTPUTS'); await shot('setup-outputs');
  await go(5);
  await page.getByText('IR REMOTE RECEIVER').first().click();
  await shot('control');
  await go(1); await shot('room', 3000);
  await browser.close();
} finally {
  killVite();
}

import { expect, test, type Locator, type Page } from '@playwright/test';

type Size = [number, number];
const SMALL: Size = [1440, 790];
const LARGE: Size = [1600, 880];

/** Mock profiles whose whole surface is swept: newest fw, small chip, oldest wire, crash-fallen-back clock. */
const PROFILES = [
  { name: 'multi', query: 'multi' },
  { name: 'multi rp2040', query: 'multi&chip=rp2040' },
  { name: 'legacy', query: 'legacy' },
  { name: 'multi sysclock fallback', query: 'multi&sysclock=fallback' },
];
const mockUrl = (query: string) => `/?mock=${query}`;
const FULL = mockUrl('multi');
const FLEET = '/?mock=rp2040,rp2350';
const CS_FULL = mockUrl('multi&cs=full');

/**
 * Containers whose height/width is budgeted by the layout. They are
 * `overflow: hidden`, so overflow is clipped silently; the scrollHeight check
 * catches that. A box with `overflow-x: visible` clips nothing sideways, so
 * a deliberate flyout escaping it (the rail's PRESETS flyout) is not flagged.
 * `[data-budget]` marks them in components; the class selectors cover the shell skeleton.
 */
const BUDGET_SELECTORS = [
  '[data-budget]',
  '.noveau-shell',
  '.crail',
  '.rail-body',
  '.ws',
  '.tune',
  '.inspector',
  '.graph',
  '.stage',
  '.dense',
];

interface LayoutReport {
  docH: number;
  innerH: number;
  docW: number;
  innerW: number;
  offenders: string[];
}

/** Runs in the page: must stay self-contained (no outer references). */
function scanLayout(budgetSelectors: string[]): LayoutReport {
  const de = document.documentElement;
  const path = (el: Element): string => {
    const parts: string[] = [];
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const cls = typeof n.className === 'string' && n.className.trim()
        ? '.' + n.className.trim().split(/\s+/).join('.')
        : '';
      parts.unshift(n.tagName.toLowerCase() + cls);
    }
    return parts.join(' > ');
  };
  const budget = budgetSelectors.join(',');
  const scrolls = (v: string) => v === 'auto' || v === 'scroll';
  const offenders: string[] = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('[data-scroll-ok]')) continue;
    const cs = getComputedStyle(el);
    const clipped =
      el.matches(budget) &&
      (el.scrollHeight > el.clientHeight + 1 ||
        (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1));
    const scrolling =
      (scrolls(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
      (scrolls(cs.overflowX) && el.scrollWidth > el.clientWidth + 1);
    if (clipped || scrolling) offenders.push(path(el));
  }
  return { docH: de.scrollHeight, innerH: window.innerHeight, docW: de.scrollWidth, innerW: window.innerWidth, offenders };
}

/** Soft, so one sweep reports every offending page instead of stopping at the first. */
async function assertNoScroll(page: Page, where = ''): Promise<void> {
  const res = await page.evaluate(scanLayout, BUDGET_SELECTORS);
  const at = where ? `[${where}] ` : '';
  expect.soft(res.docH, `${at}document height ${res.docH} > viewport ${res.innerH}`).toBeLessThanOrEqual(res.innerH);
  expect.soft(res.docW, `${at}document width ${res.docW} > viewport ${res.innerW}`).toBeLessThanOrEqual(res.innerW);
  expect.soft(res.offenders, `${at}scrolling or clipped elements:\n${res.offenders.join('\n')}`).toEqual([]);
}

async function open(page: Page, size: Size, url: string): Promise<void> {
  await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto(url);
  const shell = page.locator('.noveau-shell');
  const hero = page.getByRole('button', { name: 'CONNECT', exact: true });
  await expect(shell.or(hero)).toBeVisible({ timeout: 20_000 });
  if (await hero.isVisible()) await hero.click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.rail-body .row').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.tune')).toBeVisible();
  // Short settle so the mock's first telemetry frames land before measuring.
  await page.waitForTimeout(500);
}

function railRows(page: Page, group: 'INPUTS' | 'OUTPUTS') {
  return page.locator('.rail-body .microlbl', { hasText: group }).locator('~ .pair .row');
}

function destination(page: Page, name: string): Locator {
  return page.locator('nav.irail .ib', { hasText: name });
}

/** Switches every output on, so the matrix, the Sources list and the rail are at their fullest. */
async function enableAllOutputs(page: Page): Promise<void> {
  await destination(page, 'TUNE').click();
  const rows = railRows(page, 'OUTPUTS');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click();
    const toggle = page.getByRole('switch', { name: 'Output enabled' });
    if ((await toggle.count()) === 0) continue;
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  }
}

async function sweepProgram(page: Page, where: string): Promise<void> {
  await expect(page.locator('.routing')).toBeVisible();
  const hits = page.locator('.chain .hit');
  const n = await hits.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await hits.nth(i).click();
    await expect(hits.nth(i)).toHaveAttribute('aria-pressed', 'true');
    await assertNoScroll(page, `${where} PROGRAM module ${i}`);
  }
  await page.locator('.routing .dotbtn').last().click();
  await expect(page.getByRole('dialog', { name: /^Crosspoint/ })).toBeVisible();
  await assertNoScroll(page, `${where} PROGRAM crosspoint`);
  await page.keyboard.press('Escape');
}

async function sweepPages(page: Page, tablist: string, where: string, afterEach?: (label: string) => Promise<void>): Promise<void> {
  const pages = page.getByRole('tablist', { name: tablist }).getByRole('tab');
  await expect(pages.first()).toBeVisible();
  const n = await pages.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const label = (await pages.nth(i).innerText()).trim();
    await pages.nth(i).click();
    await expect(pages.nth(i)).toHaveAttribute('aria-selected', 'true');
    await assertNoScroll(page, `${where} ${tablist} ${label}`);
    await afterEach?.(label);
  }
}

async function sweepPresets(page: Page, where: string): Promise<void> {
  const toggle = page.locator('[data-presets-toggle]');
  const flyout = page.getByRole('dialog', { name: 'Presets' });
  await toggle.click();
  await expect(flyout).toBeVisible();
  await expect(flyout.getByRole('textbox', { name: 'Preset name' })).toBeVisible();
  await assertNoScroll(page, `${where} presets flyout`);
  await page.keyboard.press('Escape');
  await expect(flyout).toBeHidden();
}

/** Every destination, page, module and selection of one booted profile. */
async function sweepProfile(page: Page, where: string): Promise<void> {
  await enableAllOutputs(page);
  await assertNoScroll(page, `${where} TUNE`);
  await railRows(page, 'OUTPUTS').last().click();
  await expect(page.getByLabel('Mute output')).toBeVisible();
  await assertNoScroll(page, `${where} last output selected`);
  await railRows(page, 'INPUTS').first().click();
  await expect(page.getByLabel('PREAMP', { exact: true })).toBeVisible();
  await assertNoScroll(page, `${where} first input selected`);
  await sweepPresets(page, `${where} TUNE`);

  const labels = (await page.locator('nav.irail .ib').allInnerTexts()).map((t) => t.trim());
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    await destination(page, label).click();
    await expect(page.locator('.noveau-shell')).toBeVisible();
    await assertNoScroll(page, `${where} ${label}`);
    if (label.includes('PROGRAM')) await sweepProgram(page, where);
    else if (label.includes('SETUP')) {
      await sweepPages(page, 'Setup pages', where);
      await sweepPresets(page, `${where} SETUP`);
    } else if (label.includes('CONTROL')) await sweepPages(page, 'Control pages', where);
  }
}

for (const p of PROFILES) {
  test(`no scroll ${SMALL.join('x')} ${p.name} full sweep`, async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, SMALL, mockUrl(p.query));
    await sweepProfile(page, p.name);
  });
}

test(`no scroll ${LARGE.join('x')} multi full sweep`, async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, LARGE, FULL);
  await sweepProfile(page, `multi ${LARGE.join('x')}`);
});

test('no scroll 1440x790 two-device fleet', async ({ page }) => {
  await open(page, SMALL, FLEET);
  await assertNoScroll(page, 'fleet');
});

test('no scroll 1440x790 CONTROL surfaces add control and IR receiver', async ({ page }) => {
  await open(page, SMALL, FULL);
  await destination(page, 'CONTROL').click();
  const pages = page.getByRole('tablist', { name: 'Control pages' }).getByRole('tab');
  await pages.filter({ hasText: 'SURFACES' }).click();
  const add = page.locator('select[aria-label="Add control"]').first();
  await expect(add).toBeEnabled();
  const opts = await add.locator('option:not([disabled])').evaluateAll(
    (os) => (os as HTMLOptionElement[]).filter((o) => o.value !== '').map((o) => ({ v: o.value, label: o.textContent ?? '' })),
  );
  expect(opts.length).toBeGreaterThan(0);
  await add.selectOption(opts[0].v);
  await assertNoScroll(page, 'new binding');
  const ir = opts.find((o) => o.label.includes('IR Remote Receiver'));
  if (ir) {
    await add.selectOption(ir.v);
    const binding = page.locator('.detail', { hasText: 'BINDING' });
    const apply = binding.getByRole('button', { name: 'APPLY', exact: true });
    if ((await apply.count()) > 0 && (await apply.first().isEnabled())) await apply.first().click();
    const commands = page.locator('.detail', { hasText: 'IR COMMANDS' });
    await expect(commands.locator('.irrow').first()).toBeVisible();
    await assertNoScroll(page, 'new IR receiver');
  }
});

for (const size of [SMALL, LARGE]) {
  test(`no scroll ${size.join('x')} CONTROL at capacity with a slot editor open`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, size, CS_FULL);
    await destination(page, 'CONTROL').click();
    await sweepPages(page, 'Control pages', 'cs=full closed');
    const pages = page.getByRole('tablist', { name: 'Control pages' }).getByRole('tab');
    const n = await pages.count();
    for (let i = 0; i < n; i++) {
      await pages.nth(i).click();
      const label = (await pages.nth(i).innerText()).trim();
      if (label.startsWith('MACROS')) await expect.poll(() => page.locator('.pw-cols:not([hidden]) .slothead').count()).toBeGreaterThanOrEqual(8);
      const panels = page.locator('.pw-cols:not([hidden]) section.panel');
      const count = await panels.count();
      let opened = 0;
      for (let k = 0; k < count; k++) {
        const head = panels.nth(k).locator('.slothead .hdrbtn').first();
        if ((await head.count()) > 0) {
          if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
          await expect(head).toHaveAttribute('aria-expanded', 'true');
          opened++;
          continue;
        }
        // The display panel selects a page chip instead of expanding a slot.
        const chip = panels.nth(k).locator('.pagestrip [role=tab]').first();
        if ((await chip.count()) === 0) continue;
        await chip.click();
        await expect(chip).toHaveAttribute('aria-selected', 'true');
        opened++;
      }
      if (label !== 'INTERFACES') expect(opened, `${label}: no slot editor opened`).toBeGreaterThan(0);
      await assertNoScroll(page, `cs=full ${label} editor open (${opened} panels)`);
    }
  });
}

test('no scroll 1440x790 rail with a full device list and every output enabled', async ({ page }) => {
  // Two devices fit the cap; four exceed it and spill into the popover.
  await open(page, SMALL, mockUrl('multi,multi,multi,multi'));
  await enableAllOutputs(page);
  const devices = page.getByRole('group', { name: 'Devices' });
  await expect(devices.locator('button.row')).toHaveCount(2);
  await assertNoScroll(page, 'rail 4 devices');
  await page.getByRole('button', { name: /more devices$/ }).click();
  const pop = page.getByRole('dialog', { name: 'More devices' });
  await expect(pop.locator('button.row')).toHaveCount(2);
  await assertNoScroll(page, 'rail device popover');
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});

test('no scroll 1440x790 two-device rail with every output enabled', async ({ page }) => {
  await open(page, SMALL, mockUrl('multi,multi'));
  await enableAllOutputs(page);
  await expect(page.getByRole('group', { name: 'Devices' }).locator('button.row')).toHaveCount(2);
  await assertNoScroll(page, 'rail 2 devices');
});

test('no scroll 1440x790 AutoEQ library pages instead of scrolling', async ({ page }) => {
  await open(page, SMALL, FULL);
  await page.getByRole('button', { name: 'AutoEQ…' }).click();
  const dialog = page.getByRole('dialog', { name: 'AutoEQ library' });
  await expect(dialog).toBeVisible();
  const rows = dialog.locator('.list .row');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const range = dialog.locator('.range');
  await expect(range).toHaveText(/^1–12 of \d+$/);
  await assertNoScroll(page, 'AutoEQ page 1');
  await rows.first().locator('.row-main').focus();
  await page.keyboard.press('PageDown');
  await expect(range).toHaveText(/^13–24 of \d+$/);
  await assertNoScroll(page, 'AutoEQ page 2');
  await rows.first().locator('.row-main').focus();
  await page.keyboard.press('PageUp');
  await expect(range).toHaveText(/^1–12 of \d+$/);
  await dialog.getByPlaceholder('SEARCH…').fill('zzzz-no-such-profile');
  await expect(range).toHaveText('0–0 of 0');
  await assertNoScroll(page, 'AutoEQ empty result');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('no scroll 1440x790 PRESETS editor flyout', async ({ page }) => {
  await open(page, SMALL, FULL);
  const toggle = page.locator('[data-presets-toggle]');
  const flyout = page.getByRole('dialog', { name: 'Presets' });
  await toggle.click();
  await expect(flyout).toBeVisible();
  const name = flyout.getByRole('textbox', { name: 'Preset name' });
  await expect(name).toBeVisible();
  await expect(flyout.getByRole('radiogroup', { name: 'Startup preset' })).toBeVisible();
  expect(await flyout.locator('.chips .chip').count()).toBeGreaterThan(0);
  await assertNoScroll(page, 'presets editor');
  await name.focus();
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  await expect(flyout).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(flyout).toBeHidden();
});

/** Stubs WebUSB so the real connect path fails the way each hero state needs. */
async function stubUsb(page: Page, kind: 'error' | 'in-use'): Promise<void> {
  await page.addInitScript((k) => {
    const diag = Array.from({ length: 40 }, (_, i) => `    at transfer (chunk-${i}.js:${40 + i}:17) while reading the device descriptor`).join('\n');
    const device = {
      serialNumber: 'STUB-0001',
      opened: false,
      configuration: null as unknown,
      async open() { this.opened = true; },
      async selectConfiguration() { this.configuration = { interfaces: [] }; },
      async claimInterface() { throw new Error('Unable to claim interface.'); },
      async releaseInterface() {},
      async close() { this.opened = false; },
    };
    const usb = {
      async getDevices() { return []; },
      async requestDevice() {
        if (k === 'error') throw new Error(`USB transfer failed\n${diag}`);
        return device;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(navigator, 'usb', { value: usb, configurable: true });
  }, kind);
}

async function connectToHero(page: Page, size: Size): Promise<void> {
  await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto('/?hero');
  const connect = page.getByRole('button', { name: 'CONNECT', exact: true });
  await expect(connect).toBeVisible({ timeout: 20_000 });
  await connect.click();
}

for (const size of [SMALL, LARGE]) {
  test(`no scroll ${size.join('x')} hero initial and Linux setup expanded`, async ({ page }) => {
    await page.setViewportSize({ width: size[0], height: size[1] });
    await page.goto('/?hero');
    await expect(page.getByRole('button', { name: 'CONNECT', exact: true })).toBeVisible({ timeout: 20_000 });
    await assertNoScroll(page, 'hero initial');
    await page.locator('.linux-panel summary').click();
    await expect(page.locator('.linux-panel')).toHaveAttribute('open', '');
    await assertNoScroll(page, 'hero linux expanded');
  });

  test(`no scroll ${size.join('x')} hero connection error diagnostics`, async ({ page }) => {
    await stubUsb(page, 'error');
    await connectToHero(page, size);
    await expect(page.getByRole('alert', { name: 'Connection error details' })).toBeVisible();
    await assertNoScroll(page, 'hero error');
    await page.locator('.linux-panel summary').click();
    await assertNoScroll(page, 'hero error + linux expanded');
  });

  test(`no scroll ${size.join('x')} hero device in use`, async ({ page }) => {
    await stubUsb(page, 'in-use');
    await connectToHero(page, size);
    await expect(page.getByRole('alert', { name: 'Device in use' })).toBeVisible();
    await assertNoScroll(page, 'hero device in use');
    await page.locator('.linux-panel summary').click();
    await assertNoScroll(page, 'hero device in use + linux expanded');
  });
}

test('detector reports an injected scrolling element', async ({ page }) => {
  await open(page, SMALL, FULL);
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'layout-probe';
    d.style.cssText = 'overflow:auto;height:40px';
    const inner = document.createElement('div');
    inner.style.height = '400px';
    d.appendChild(inner);
    document.querySelector('.noveau-shell')!.appendChild(d);
  });
  const res = await page.evaluate(scanLayout, BUDGET_SELECTORS);
  await page.evaluate(() => document.querySelector('.layout-probe')?.remove());
  expect(res.offenders.some((o) => o.endsWith('div.layout-probe'))).toBe(true);
});

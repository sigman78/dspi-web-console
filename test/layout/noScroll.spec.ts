import { expect, test, type Page } from '@playwright/test';

const FULL = '/?mock=multi&ui=noveau';
const FLEET = '/?mock=rp2040,rp2350&ui=noveau';

/**
 * Containers whose height/width is budgeted by the layout. They are
 * `overflow: hidden`, so overflow is clipped silently; the scrollHeight check
 * catches that. `[data-budget]` is the preferred marker once components carry
 * it; the class selectors are the interim list.
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
  '.line',
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
      (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    const scrolling =
      (scrolls(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
      (scrolls(cs.overflowX) && el.scrollWidth > el.clientWidth + 1);
    if (clipped || scrolling) offenders.push(path(el));
  }
  return { docH: de.scrollHeight, innerH: window.innerHeight, docW: de.scrollWidth, innerW: window.innerWidth, offenders };
}

async function assertNoScroll(page: Page): Promise<void> {
  const res = await page.evaluate(scanLayout, BUDGET_SELECTORS);
  expect(res.docH, `document height ${res.docH} > viewport ${res.innerH}`).toBeLessThanOrEqual(res.innerH);
  expect(res.docW, `document width ${res.docW} > viewport ${res.innerW}`).toBeLessThanOrEqual(res.innerW);
  expect(res.offenders, `scrolling or clipped elements:\n${res.offenders.join('\n')}`).toEqual([]);
}

async function open(page: Page, size: [number, number], url: string): Promise<void> {
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

for (const size of [[1440, 790], [1600, 880]] as [number, number][]) {
  test(`no scroll ${size[0]}x${size[1]} full surface`, async ({ page }) => {
    await open(page, size, FULL);
    await assertNoScroll(page);
  });
}

test('no scroll 1440x790 two-device fleet', async ({ page }) => {
  await open(page, [1440, 790], FLEET);
  await assertNoScroll(page);
});

test('no scroll 1440x790 every destination', async ({ page }) => {
  await open(page, [1440, 790], FULL);
  const buttons = page.locator('nav.irail .ib');
  const n = await buttons.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await buttons.nth(i).click();
    await expect(page.locator('.noveau-shell')).toBeVisible();
    await assertNoScroll(page);
  }
});

test('no scroll 1440x790 last output selected', async ({ page }) => {
  await open(page, [1440, 790], FULL);
  await railRows(page, 'OUTPUTS').last().click();
  await expect(page.getByLabel('Mute output')).toBeVisible();
  await assertNoScroll(page);
});

test('no scroll 1440x790 first input selected', async ({ page }) => {
  await open(page, [1440, 790], FULL);
  await railRows(page, 'INPUTS').first().click();
  await expect(page.getByLabel('Input preamp')).toBeVisible();
  await assertNoScroll(page);
});

test('detector reports an injected scrolling element', async ({ page }) => {
  await open(page, [1440, 790], FULL);
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

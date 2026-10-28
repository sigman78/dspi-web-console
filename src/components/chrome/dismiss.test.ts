import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clampToBounds, dismiss, registerLayer } from './dismiss';

let host: HTMLElement;
let inside: HTMLElement;
let anchor: HTMLElement;
let outside: HTMLElement;

beforeEach(() => {
  document.body.innerHTML =
    '<div id="host"><button id="inside"></button></div><button class="anchor"><i id="anchor-child"></i></button><div id="outside"></div>';
  host = document.getElementById('host')!;
  inside = document.getElementById('inside')!;
  anchor = document.getElementById('anchor-child')!;
  outside = document.getElementById('outside')!;
});
afterEach(() => {
  document.body.innerHTML = '';
});

function down(el: Element): void {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}
function esc(el: Element = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
}

describe('dismiss', () => {
  test('pointerdown outside dismisses, inside does not', () => {
    const onDismiss = vi.fn();
    const a = dismiss(host, { onDismiss });
    down(inside);
    expect(onDismiss).not.toHaveBeenCalled();
    down(outside);
    expect(onDismiss).toHaveBeenCalledOnce();
    a.destroy();
  });

  test('pointerdown on the ignored anchor does not dismiss', () => {
    const onDismiss = vi.fn();
    const a = dismiss(host, { onDismiss, ignore: '.anchor' });
    down(anchor);
    expect(onDismiss).not.toHaveBeenCalled();
    a.destroy();
  });

  test('Escape dismisses unless already handled', () => {
    const onDismiss = vi.fn();
    const a = dismiss(host, { onDismiss });
    esc();
    expect(onDismiss).toHaveBeenCalledOnce();
    inside.addEventListener('keydown', (e) => e.preventDefault());
    esc(inside);
    expect(onDismiss).toHaveBeenCalledOnce();
    a.destroy();
  });

  test('escape: false leaves Escape alone', () => {
    const onDismiss = vi.fn();
    const a = dismiss(host, { onDismiss, escape: false });
    esc();
    expect(onDismiss).not.toHaveBeenCalled();
    a.destroy();
  });

  test('stops listening after destroy', () => {
    const onDismiss = vi.fn();
    dismiss(host, { onDismiss }).destroy();
    down(outside);
    esc();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test('update swaps the callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = dismiss(host, { onDismiss: first });
    a.update({ onDismiss: second });
    down(outside);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    a.destroy();
  });
});

describe('clampToBounds', () => {
  test('keeps an in-bounds box where it was anchored', () => {
    expect(clampToBounds(10, 20, 50, 40, 300, 200)).toEqual({ left: 10, top: 20, clamped: false });
  });

  test('pulls an overflowing box back inside and flags a vertical shift', () => {
    expect(clampToBounds(280, 190, 50, 40, 300, 200)).toEqual({ left: 250, top: 160, clamped: true });
  });

  test('a box larger than the bounds pins to the origin', () => {
    const r = clampToBounds(5, 5, 400, 300, 300, 200);
    expect([r.left, r.top]).toEqual([0, 0]);
  });
});

describe('Escape layering', () => {
  test('with two layers open, one Escape closes only the top one', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    const a = dismiss(host, { onDismiss: lower });
    const b = dismiss(inside, { onDismiss: upper });
    esc();
    expect(upper).toHaveBeenCalledOnce();
    expect(lower).not.toHaveBeenCalled();
    b.destroy();
    esc();
    expect(lower).toHaveBeenCalledOnce();
    a.destroy();
  });

  test('a registered layer above a dismiss layer takes the Escape', () => {
    const popover = vi.fn();
    const modal = vi.fn();
    const a = dismiss(host, { onDismiss: popover });
    const unregister = registerLayer(() => modal());
    esc();
    expect(modal).toHaveBeenCalledOnce();
    expect(popover).not.toHaveBeenCalled();
    unregister();
    a.destroy();
  });
});

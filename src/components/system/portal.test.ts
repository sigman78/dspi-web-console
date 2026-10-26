import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import PortalHarness from './PortalHarness.test.svelte';

function mount() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const r = render(PortalHarness, { props: { t: target, on: true } });
  const host = r.container.querySelector('.host') as HTMLElement;
  const set = (t: HTMLElement | null, on: boolean) => { r.component.set(t, on); flushSync(); };
  return { target, host, set };
}

describe('portal', () => {
  test('moves into the target, back before its marker, and again', () => {
    const { target, host, set } = mount();
    const b = () => document.querySelector('b') as HTMLElement;
    expect(b().parentNode).toBe(target);
    expect(host.querySelector('b')).toBeNull();

    set(null, true);
    expect(b().parentNode).toBe(host);
    expect(b().previousSibling).toBe(host.querySelector('i'));
    expect((b().nextSibling as Comment).data).toBe('portal');
    expect(host.querySelector('.after')).not.toBeNull();

    set(target, true);
    expect(b().parentNode).toBe(target);
    expect(host.querySelector('.after')).not.toBeNull();
    target.remove();
  });

  test('removing the block leaves the sibling and no stray nodes', () => {
    const { target, host, set } = mount();
    set(null, true);
    set(null, false);
    expect(document.querySelector('b')).toBeNull();
    expect(host.querySelector('i')).toBeNull();
    expect(host.querySelector('.after')).not.toBeNull();
    expect(Array.from(host.childNodes).some((n) => n.nodeType === Node.COMMENT_NODE && (n as Comment).data === 'portal')).toBe(false);

    set(target, true);
    set(target, false);
    expect(target.childNodes.length).toBe(0);
    target.remove();
  });
});

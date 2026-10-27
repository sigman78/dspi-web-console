import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { BODE_BINS } from '@/domain';
import BodePlot from './BodePlot.svelte';

const curve = { id: 'c', points: new Array<number>(BODE_BINS).fill(0) };

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 720, bottom: 220, width: 720, height: 220, x: 0, y: 0, toJSON: () => ({}),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BodePlot nodes', () => {
  test('drag reports clamped values, then ends once', async () => {
    const onNodeSelect = vi.fn();
    const onNodeDrag = vi.fn();
    const onNodeDragEnd = vi.fn();
    render(BodePlot, {
      props: {
        curves: [curve],
        nodes: [{ id: 'b1', f: 1000, db: 0, label: '1' }],
        onNodeSelect,
        onNodeDrag,
        onNodeDragEnd,
      },
    });
    const node = screen.getByRole('slider');
    await fireEvent.pointerDown(node, { clientX: 300, clientY: 100, button: 0 });
    expect(onNodeSelect).toHaveBeenCalledWith('b1');
    await fireEvent.pointerMove(node, { clientX: 99999, clientY: -500 });
    expect(onNodeDrag).toHaveBeenLastCalledWith('b1', 20000, 24);
    await fireEvent.pointerUp(node, {});
    await fireEvent.pointerUp(node, {});
    expect(onNodeDragEnd).toHaveBeenCalledOnce();
    expect(onNodeDragEnd).toHaveBeenCalledWith('b1', 20000, 24);
  });

  test('a plain click selects without committing a write', async () => {
    const onNodeSelect = vi.fn();
    const onNodeDrag = vi.fn();
    const onNodeDragEnd = vi.fn();
    render(BodePlot, {
      props: {
        curves: [curve],
        nodes: [{ id: 'b1', f: 1000, db: 0 }],
        onNodeSelect,
        onNodeDrag,
        onNodeDragEnd,
      },
    });
    const node = screen.getByRole('slider');
    await fireEvent.pointerDown(node, { clientX: 300, clientY: 100, button: 0 });
    await fireEvent.pointerUp(node, {});
    expect(onNodeSelect).toHaveBeenCalledWith('b1');
    expect(onNodeDrag).not.toHaveBeenCalled();
    expect(onNodeDragEnd).not.toHaveBeenCalled();
  });

  test('keyboard repeats accumulate and commit once on keyup', async () => {
    const onNodeDrag = vi.fn();
    const onNodeDragEnd = vi.fn();
    render(BodePlot, {
      props: { curves: [curve], nodes: [{ id: 'b1', f: 1000, db: 0 }], onNodeDrag, onNodeDragEnd },
    });
    const node = screen.getByRole('slider');
    await fireEvent.keyDown(node, { key: 'ArrowUp', shiftKey: true });
    await fireEvent.keyDown(node, { key: 'ArrowUp', shiftKey: true, repeat: true });
    expect(onNodeDrag).toHaveBeenNthCalledWith(1, 'b1', 1000, 1);
    expect(onNodeDrag).toHaveBeenNthCalledWith(2, 'b1', 1000, 2);
    expect(onNodeDragEnd).not.toHaveBeenCalled();
    await fireEvent.keyUp(node, { key: 'ArrowUp' });
    expect(onNodeDragEnd).toHaveBeenCalledOnce();
    expect(onNodeDragEnd).toHaveBeenCalledWith('b1', 1000, 2);
  });
});

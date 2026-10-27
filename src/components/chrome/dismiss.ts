export interface DismissOptions {
  onDismiss: () => void;
  /** Selector for an anchor whose clicks must not dismiss (it toggles the surface itself). */
  ignore?: string;
  /** Set false to leave Escape to the caller. */
  escape?: boolean;
}

type LayerHandler = (e: KeyboardEvent) => void;

const layers: LayerHandler[] = [];

function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  layers[layers.length - 1]?.(e);
}

/**
 * Put an Escape handler on the layer stack. Only the topmost layer receives
 * Escape, so a modal above a popover takes the key and the popover stays.
 */
export function registerLayer(handler: LayerHandler): () => void {
  if (layers.length === 0) window.addEventListener('keydown', onEscape);
  layers.push(handler);
  return () => {
    const i = layers.lastIndexOf(handler);
    if (i >= 0) layers.splice(i, 1);
    if (layers.length === 0) window.removeEventListener('keydown', onEscape);
  };
}

/**
 * Dismiss a popover on a pointerdown outside it or on Escape. Escape goes to
 * the topmost layer only and is skipped when already handled
 * (`defaultPrevented`), so a text field that consumes its own Escape keeps the
 * surface open.
 */
export function dismiss(node: HTMLElement, options: DismissOptions) {
  let opts = options;

  const onPointerDown = (e: PointerEvent): void => {
    const target = e.target;
    if (!(target instanceof Node) || node.contains(target)) return;
    if (opts.ignore && target instanceof Element && target.closest(opts.ignore)) return;
    opts.onDismiss();
  };
  const unregister = registerLayer((e) => {
    if (opts.escape === false) return;
    opts.onDismiss();
    e.preventDefault();
  });

  window.addEventListener('pointerdown', onPointerDown, true);
  return {
    update(next: DismissOptions) {
      opts = next;
    },
    destroy() {
      window.removeEventListener('pointerdown', onPointerDown, true);
      unregister();
    },
  };
}

/** Keep a w x h box anchored at (x, y) inside the bounds. `clamped` is true when it was pushed vertically off its anchor. */
export function clampToBounds(
  x: number,
  y: number,
  w: number,
  h: number,
  boundsW: number,
  boundsH: number,
): { left: number; top: number; clamped: boolean } {
  const left = Math.max(0, Math.min(x, boundsW - w));
  const top = Math.max(0, Math.min(y, boundsH - h));
  return { left, top, clamped: top !== y };
}

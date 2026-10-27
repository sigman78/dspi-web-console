import type { Action } from 'svelte/action';

// Moves the node into `target` so a slot editor can render its body in another
// layout column while its state stays with the owning component. A null target
// returns the node to where it was rendered; the node must be the only child of
// its `{#if}` block so Svelte's own block anchors stay valid.
export const portal: Action<HTMLElement, HTMLElement | null | undefined> = (node, target) => {
  const marker = document.createComment('portal');
  node.parentNode?.insertBefore(marker, node);
  const place = (t: HTMLElement | null | undefined): void => {
    if (t) {
      if (node.parentNode !== t) t.appendChild(node);
    } else if (marker.parentNode && node.parentNode !== marker.parentNode) {
      marker.parentNode.insertBefore(node, marker);
    }
  };
  place(target);
  return {
    update: place,
    destroy() {
      node.remove();
      marker.remove();
    },
  };
};

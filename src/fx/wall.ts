import type { Bloom } from './bloom';
import type { FxPalette } from './palette';

/** A band of light standing on the floor line: the scene lays it out, steps it, and draws it. */
export interface Wall {
  readonly width: number;
  readonly height: number;
  layout(x: number, top: number, floorY: number, width: number, dpr: number, p: FxPalette): void;
  /** Static text and marks under (and beside) the floor line, on the back canvas. */
  paintLabels(c: CanvasRenderingContext2D, p: FxPalette): void;
  /** `alpha` scales everything the wall draws, glow included. */
  draw(ctx: CanvasRenderingContext2D, bloom: Bloom, decorative: boolean, alpha: number): void;
  /** Overall loudness, 0..1: what drives the room light. */
  energy(): number;
}

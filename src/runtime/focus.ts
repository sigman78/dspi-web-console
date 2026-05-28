import type {
  RouteModel, OutputModel,
  InputSlot, OutputSlot,
} from '@/domain';
import { mirror } from '@/state/mirror.svelte';

// Focused get/set into a part of mirror.current. Each focus binds an addressing
// tuple (e.g. (input, output) for a route) and exposes read() and modify(f)
// (an in-place optimistic patch). Both throw rather than no-op when the entity
// is missing or the snapshot isn't loaded; callers guard with
// `if (!mirror.current) return;` before constructing a focus.

export interface Focus<T> {
  read(): T;
  modify(f: (cur: T) => T): void;
}

// Locate a route in mirror.current.routes by (input, output) slot pair.
export function focusRoute(input: InputSlot, output: OutputSlot): Focus<RouteModel> {
  const find = (): { routes: RouteModel[]; index: number } => {
    const routes = mirror.current?.routes;
    if (!routes) throw new Error('focusRoute: snapshot not loaded');
    const index = routes.findIndex(
      (r) => r.inputIndex === input && r.outputWireIndex === output,
    );
    if (index < 0) throw new Error(`route not found: input=${input} output=${output}`);
    return { routes, index };
  };
  return {
    read() {
      const { routes, index } = find();
      return routes[index];
    },
    modify(f) {
      const { routes, index } = find();
      routes[index] = f(routes[index]);
    },
  };
}

// Locate an output by matrix/output slot. The slot is the same value sent in
// SetOutput*/SetMatrixRoute wValue/payload; on RP2040 PDM is slot 4, while
// on RP2350 it is slot 8.
export function focusOutput(slot: OutputSlot): Focus<OutputModel> {
  const find = (): { outputs: OutputModel[]; index: number } => {
    const outputs = mirror.current?.outputs;
    if (!outputs) throw new Error('focusOutput: snapshot not loaded');
    const index = outputs.findIndex((o) => o.wireIndex === slot);
    if (index < 0) throw new Error(`output not found: slot=${slot}`);
    return { outputs, index };
  };
  return {
    read() {
      const { outputs, index } = find();
      return outputs[index];
    },
    modify(f) {
      const { outputs, index } = find();
      outputs[index] = f(outputs[index]);
    },
  };
}

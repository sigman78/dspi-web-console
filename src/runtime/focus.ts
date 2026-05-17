import type {
  RouteModel, OutputModel,
  ChannelModel,
  ChannelId, InputSlot, OutputSlot,
} from '../domain';
import { dsp, patchSnapshot } from '../state';

// Focused get/set into a part of dsp.live. Each focus binds an addressing
// tuple (e.g. (input, output) for a route) and exposes:
//   - read(): current value, throws if missing
//   - modify(f): apply an optimistic patch via patchSnapshot
//
// "Missing" means the addressed entity isn't in the snapshot -- a programmer
// or platform-shape bug, not a transient state. read() and modify() both
// throw rather than silently no-op.
//
// "Snapshot not loaded" (dsp.live === null during pre-connect or post-
// disconnect) is also a throw -- callers wrap in `if (!dsp.live) return;`
// guards before constructing a focus, matching the existing convention.

export interface Focus<T> {
  read(): T;
  modify(f: (cur: T) => T): void;
}

// Locate a route in dsp.live.routes by (input, output) slot pair.
export function focusRoute(input: InputSlot, output: OutputSlot): Focus<RouteModel> {
  const find = (): { routes: readonly RouteModel[]; index: number } => {
    const routes = dsp.live?.routes;
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
      const next = f(routes[index]);
      const newRoutes = routes.slice();
      newRoutes[index] = next;
      patchSnapshot({ routes: newRoutes });
    },
  };
}

// Locate an output by matrix/output slot. The slot is the same value sent in
// SetOutput*/SetMatrixRoute wValue/payload; on RP2040 PDM is slot 4, while
// on RP2350 it is slot 8.
export function focusOutput(slot: OutputSlot): Focus<OutputModel> {
  const find = (): { outputs: readonly OutputModel[]; index: number } => {
    const outputs = dsp.live?.outputs;
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
      const next = f(outputs[index]);
      const newOutputs = outputs.slice();
      newOutputs[index] = next;
      patchSnapshot({ outputs: newOutputs });
    },
  };
}

// Like focusOutput but returns null when the slot is absent from the current
// platform's outputs[] (e.g. RP2040 lacks RP2350 slots 5..8). Callers that
// mirror denormalised state across channels[]/outputs[] use this to silently
// skip platform-absent slots without an extra `.some(...)` probe.
export function tryFocusOutput(slot: OutputSlot): Focus<OutputModel> | null {
  if (!dsp.live?.outputs.some((o) => o.wireIndex === slot)) return null;
  return focusOutput(slot);
}

// Locate a channel in dsp.live.channels by ChannelId.
export function focusChannel(id: ChannelId): Focus<ChannelModel> {
  const find = (): { channels: readonly ChannelModel[]; index: number } => {
    const channels = dsp.live?.channels;
    if (!channels) throw new Error('focusChannel: snapshot not loaded');
    const index = channels.findIndex((c) => c.id === id);
    if (index < 0) throw new Error(`channel not found: ${id}`);
    return { channels, index };
  };
  return {
    read() {
      const { channels, index } = find();
      return channels[index];
    },
    modify(f) {
      const { channels, index } = find();
      const next = f(channels[index]);
      const newChannels = channels.slice();
      newChannels[index] = next;
      patchSnapshot({ channels: newChannels });
    },
  };
}

import type { RouteModel, OutputModel } from '../domain/mixer';
import type { ChannelModel } from '../domain/snapshot';
import type { ChannelId, InputSlot, OutputSlot } from '../domain/channels';
import { dsp, patchSnapshot } from '../state/dsp.svelte';

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

// Locate an output by wire slot. Find-by-wireIndex (not array index) so
// platforms with sparse output sets work -- RP2040's outputs[] has 5 entries
// at array indices 0..4, but Pdm's wireIndex is 8. Lookup by wireIndex
// keeps the action layer's slot semantics consistent across platforms.
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
// platform's outputs[] (e.g. RP2040 lacks Out3/Out4 entries). Callers that
// mirror denormalised state across channels[]/outputs[] use this to silently
// skip sparse-platform slots without an extra `.some(...)` probe.
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

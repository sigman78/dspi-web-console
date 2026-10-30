// Console side that drives a device owned by another console: the tunnel
// becomes an ordinary device record.

import * as State from '@/state';
import { GIT_SHA } from '@/buildInfo';
import { RemoteTransport } from '@/transport/remote/RemoteTransport';
import type { FrameChannel } from '@/transport/remote/FrameChannel';
import { errMessage } from '@/utils';
import { ConnectionScope } from '@/runtime/connectionScope';
import { createBoundDevice, reportConnectError } from '@/runtime/boot';
import { wireUpConnection } from '@/runtime/deviceService';

// Above the owner's own 2 s transfer deadline, so an owner-side timeout
// arrives as a typed error instead of racing this side's timer.
export const REMOTE_CTRL_TIMEOUT_MS = 3000;

/** Adopts the tunnel's device; resolves with its record id. */
export async function joinRemote(channel: FrameChannel, peerLabel: string): Promise<State.ConnId> {
  if (State.shareState() !== 'idle') {
    channel.close();
    throw new Error("Stop sharing this console's device first");
  }
  const id = State.mintConnId();
  const scope = new ConnectionScope();
  let remote: RemoteTransport | undefined;
  try {
    // Connect before binding: the decorators copy notifyIn at wrap time.
    const connected = await RemoteTransport.connect(channel, { consoleBuild: GIT_SHA, wantReadOnly: false });
    remote = connected;
    const device = await createBoundDevice(connected, scope, id, () => connected.open(), REMOTE_CTRL_TIMEOUT_MS);
    await wireUpConnection(device, scope, id, { remote: { peerLabel } });
    return id;
  } catch (err) {
    if (!scope.aborted) scope.abort();
    // Releases the owner's lease if the tunnel came up but adoption did not.
    await remote?.close();
    if (State.activeRecord() === null) reportConnectError(id, err);
    else State.pushNotice('error', `Couldn't join the remote device: ${errMessage(err)}`);
    throw err;
  }
}

// Copy/paste signaling for the two-tab and two-machine spike: no server, no
// trickle ICE. Each description is a JSON string holding the complete SDP.

import * as Peer from './peer';

// Host candidates only. Add { urls: 'stun:stun.cloudflare.com:3478' } if two
// machines cannot find each other.
const ICE_SERVERS: RTCIceServer[] = [];

export interface HostSession {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  offer: string;
}

export interface JoinSession {
  pc: RTCPeerConnection;
  channel: Promise<RTCDataChannel>;
  answer: string;
}

function gatheringComplete(pc: RTCPeerConnection, signal?: AbortSignal): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const settle = (): void => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      signal?.removeEventListener('abort', onAbort);
    };
    const onChange = (): void => {
      if (pc.iceGatheringState !== 'complete') return;
      settle();
      resolve();
    };
    const onAbort = (): void => { settle(); reject(new Error('stopped gathering candidates')); };
    if (signal?.aborted) { onAbort(); return; }
    pc.addEventListener('icegatheringstatechange', onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function encode(desc: RTCSessionDescription | null): string {
  if (!desc) throw new Error('no local description');
  return JSON.stringify({ type: desc.type, sdp: desc.sdp });
}

function decode(text: string, type: RTCSdpType): RTCSessionDescriptionInit {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not a session description');
  const { type: t, sdp } = parsed as { type?: unknown; sdp?: unknown };
  if (t !== type || typeof sdp !== 'string') throw new Error(`expected an ${type}`);
  return { type, sdp };
}

// A failed or aborted setup closes its peer connection.
export async function createOffer(signal?: AbortSignal): Promise<HostSession> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  try {
    const dc = Peer.createTunnelChannel(pc);
    await pc.setLocalDescription(await pc.createOffer());
    await gatheringComplete(pc, signal);
    if (signal?.aborted) throw new Error('stopped gathering candidates');
    return { pc, dc, offer: encode(pc.localDescription) };
  } catch (err) {
    pc.close();
    throw err;
  }
}

export async function acceptAnswer(host: HostSession, answer: string): Promise<void> {
  await host.pc.setRemoteDescription(decode(answer, 'answer'));
}

export async function createAnswer(offer: string, signal?: AbortSignal): Promise<JoinSession> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  try {
    const channel = Peer.awaitTunnelChannel(pc);
    await pc.setRemoteDescription(decode(offer, 'offer'));
    await pc.setLocalDescription(await pc.createAnswer());
    await gatheringComplete(pc, signal);
    if (signal?.aborted) throw new Error('stopped gathering candidates');
    return { pc, channel, answer: encode(pc.localDescription) };
  } catch (err) {
    pc.close();
    throw err;
  }
}

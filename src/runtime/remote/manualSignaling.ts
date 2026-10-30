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

function gatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = (): void => {
      if (pc.iceGatheringState !== 'complete') return;
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    pc.addEventListener('icegatheringstatechange', onChange);
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

export async function createOffer(): Promise<HostSession> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const dc = Peer.createTunnelChannel(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await gatheringComplete(pc);
  return { pc, dc, offer: encode(pc.localDescription) };
}

export async function acceptAnswer(host: HostSession, answer: string): Promise<void> {
  await host.pc.setRemoteDescription(decode(answer, 'answer'));
}

export async function createAnswer(offer: string): Promise<JoinSession> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channel = Peer.awaitTunnelChannel(pc);
  await pc.setRemoteDescription(decode(offer, 'offer'));
  await pc.setLocalDescription(await pc.createAnswer());
  await gatheringComplete(pc);
  return { pc, channel, answer: encode(pc.localDescription) };
}

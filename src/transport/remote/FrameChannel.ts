// Minimal message pipe the tunnel runs over; an RTCDataChannel wrapper or an
// in-memory pair both fit.
export interface FrameChannel {
  send(frame: Uint8Array): void;
  onMessage(listener: (frame: Uint8Array) => void): () => void;
  onClose(listener: () => void): () => void;
  close(): void;
}

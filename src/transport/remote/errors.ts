// The peer's policy refused the request; the device never saw it.
export class RemoteRefused extends Error {
  override readonly name = 'RemoteRefused';
}

// The tunnel closed while a request was outstanding.
export class RemoteClosed extends Error {
  override readonly name = 'RemoteClosed';
  constructor(message = 'remote channel closed') {
    super(message);
  }
}

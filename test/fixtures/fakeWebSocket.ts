// Scriptable WebSocket stand-in: tests open it, deliver server messages and
// read what the client sent.

export class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];

  constructor(url: string) {
    super();
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { reason }));
  }

  /** Test side: the connection comes up. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  /** Test side: a message from the server. */
  receive(msg: object): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) }));
  }

  /** Test side: the server drops the connection. */
  drop(reason = ''): void {
    this.close(reason);
  }

  /** Parsed messages the client sent, excluding keepalive pings. */
  messages(): { t: string; [k: string]: unknown }[] {
    return this.sent.map((s) => JSON.parse(s) as { t: string }).filter((m) => m.t !== 'ping');
  }
}

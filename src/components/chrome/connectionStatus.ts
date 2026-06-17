export type ChromeTone = 'ok' | 'warn' | 'err' | 'idle';

export interface ChromeConnectionInput {
  phase: 'ready' | 'connecting' | 'errored' | 'noDevice';
  connected: boolean;
  degraded: boolean;
  unsupported: boolean;
}

export interface ChromeConnectionStatus {
  tone: ChromeTone;
}

function connectionTone({ phase, connected, degraded, unsupported }: ChromeConnectionInput): ChromeTone {
  if (unsupported || phase === 'errored') return 'err';
  if (connected) return degraded ? 'warn' : 'ok';
  if (phase === 'connecting') return 'warn';
  return 'idle';
}

export function chromeConnectionStatus(input: ChromeConnectionInput): ChromeConnectionStatus {
  const tone = connectionTone(input);
  return { tone };
}

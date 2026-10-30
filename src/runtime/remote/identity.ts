// The label a joining console shows to the owner: platform, browser and a
// stable two-word name. Synthesized, never typed.

import * as Store from './relayStore';

const ADJECTIVES = ['amber', 'brisk', 'calm', 'dusty', 'eager', 'faint', 'gentle', 'hazy', 'ivory', 'jolly', 'keen', 'lunar', 'mellow', 'nimble', 'olive', 'plucky'];
const ANIMALS = ['badger', 'crane', 'dingo', 'egret', 'fox', 'gecko', 'heron', 'ibex', 'jackal', 'koala', 'lynx', 'marten', 'newt', 'otter', 'panda', 'quail'];

const MAX_LABEL = 64;

// Used when storage is unavailable: stable for this page load only.
let sessionId: string | null = null;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function installId(): string {
  const stored = Store.readStore().installId;
  if (stored && /^[0-9a-f]{8}$/.test(stored)) return stored;
  const id = sessionId ?? randomId();
  sessionId = id;
  Store.writeStore({ installId: id });
  return id;
}

function deviceName(id: string): string {
  const n = parseInt(id, 16);
  return `${ADJECTIVES[n & 15]}-${ANIMALS[(n >>> 4) & 15]}`;
}

interface UaData {
  platform?: string;
  brands?: { brand: string }[];
}

function platformOf(ua: string, data: UaData | undefined): string {
  if (data?.platform) return data.platform;
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return 'Unknown';
}

const BRAND_NAMES: [brand: string, name: string][] = [
  ['Microsoft Edge', 'Edge'],
  ['Opera', 'Opera'],
  ['Brave', 'Brave'],
  ['Vivaldi', 'Vivaldi'],
  ['Google Chrome', 'Chrome'],
  ['Chromium', 'Chromium'],
];

function browserOf(ua: string, data: UaData | undefined): string {
  const brands = data?.brands?.map((b) => b.brand) ?? [];
  for (const [brand, name] of BRAND_NAMES) {
    if (brands.includes(brand)) return name;
  }
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

export function peerLabel(): string {
  const data = (navigator as Navigator & { userAgentData?: UaData }).userAgentData;
  const ua = navigator.userAgent;
  // The relay refuses labels over this length.
  const name = deviceName(installId());
  const head = `${platformOf(ua, data)} · ${browserOf(ua, data)} · `.slice(0, MAX_LABEL - name.length);
  return head + name;
}

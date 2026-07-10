// Phone detection for the mobile splash. Biased conservative: a false positive
// would lock a desktop user out of the console entirely, while a missed phone
// merely falls through to the regular connect hero. Tablets deliberately fall
// through too — iPad and Android-tablet UAs classify as desktop, and iPadOS 13+
// reports a Macintosh UA to begin with.
export interface MobileSignals {
  ua: string;
  /** navigator.userAgentData?.mobile — Chromium's own phone classification. */
  uaDataMobile: boolean | undefined;
}

export function detectMobile({ ua, uaDataMobile }: MobileSignals): boolean {
  // Must precede the Mobi fallback: legacy iPad UAs carry a "Mobile/…" token.
  if (/iPad/.test(ua)) return false;
  if (uaDataMobile === true) return true;
  if (/iPhone|iPod/.test(ua)) return true;
  // Generic phone marker (MDN's recommendation). Android phones carry "Mobile"
  // while Android tablets don't, which is exactly the split we want.
  if (/Mobi/.test(ua)) return true;
  return false;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return detectMobile({ ua: nav.userAgent, uaDataMobile: nav.userAgentData?.mobile });
}

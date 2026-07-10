// Phone/tablet detection for the mobile splash. Biased conservative: a false
// positive would lock a desktop user out of the console entirely, while a
// missed mobile merely falls through to the regular connect hero.
export interface MobileSignals {
  ua: string;
  /** navigator.userAgentData?.mobile — Chromium's own phone classification. */
  uaDataMobile: boolean | undefined;
  maxTouchPoints: number;
}

export function detectMobile({ ua, uaDataMobile, maxTouchPoints }: MobileSignals): boolean {
  if (uaDataMobile === true) return true;
  if (/iPhone|iPod|iPad/.test(ua)) return true;
  // iPadOS 13+ masquerades as macOS; real Macs report no touch points.
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return true;
  // Android without the Mobile token is a tablet — still no USB console host.
  if (/Android/.test(ua)) return true;
  // Generic marker carried by remaining mobile browsers (MDN's recommendation).
  if (/Mobi/.test(ua)) return true;
  return false;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return detectMobile({
    ua: nav.userAgent,
    uaDataMobile: nav.userAgentData?.mobile,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
  });
}

import { describe, it, expect } from 'vitest';
import { detectMobile } from './mobile';

const UA = {
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  androidPhoneChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTabletChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
  // Only the generic Mobi token marks this one as mobile — exercises the fallback branch.
  kaiOs: 'Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ipadSafariLegacy:
    'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
};

const noHints = { uaDataMobile: undefined, maxTouchPoints: 0 };

describe('detectMobile', () => {
  it.each([
    ['Windows Chrome', UA.windowsChrome],
    ['macOS Safari', UA.macSafari],
    ['Linux Firefox', UA.linuxFirefox],
  ])('classifies %s as desktop', (_name, ua) => {
    expect(detectMobile({ ua, ...noHints })).toBe(false);
  });

  it('does not flag a Windows touch laptop as mobile', () => {
    expect(detectMobile({ ua: UA.windowsChrome, uaDataMobile: false, maxTouchPoints: 10 })).toBe(false);
  });

  it.each([
    ['Android phone Chrome', UA.androidPhoneChrome],
    ['Android tablet Chrome', UA.androidTabletChrome],
    ['Android Firefox', UA.androidFirefox],
    ['KaiOS (generic Mobi token only)', UA.kaiOs],
    ['iPhone Safari', UA.iphoneSafari],
    ['legacy iPad Safari', UA.ipadSafariLegacy],
  ])('classifies %s as mobile', (_name, ua) => {
    expect(detectMobile({ ua, ...noHints })).toBe(true);
  });

  it('detects iPadOS 13+ masquerading as macOS via touch points', () => {
    expect(detectMobile({ ua: UA.macSafari, uaDataMobile: undefined, maxTouchPoints: 5 })).toBe(true);
  });

  it('trusts a userAgentData.mobile=true hint over an unrecognized UA', () => {
    expect(detectMobile({ ua: 'SomeFutureBrowser/1.0', uaDataMobile: true, maxTouchPoints: 0 })).toBe(true);
  });

  it('still flags an Android tablet when Chromium reports uaData.mobile=false', () => {
    expect(detectMobile({ ua: UA.androidTabletChrome, uaDataMobile: false, maxTouchPoints: 5 })).toBe(true);
  });
});

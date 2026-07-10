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
  androidPhoneFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
  androidTabletFirefox: 'Mozilla/5.0 (Android 14; Tablet; rv:126.0) Gecko/126.0 Firefox/126.0',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ipadSafariLegacy:
    'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  // Only the generic Mobi token marks this one as mobile — exercises the fallback branch.
  kaiOs: 'Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5',
};

const noHints = { uaDataMobile: undefined };

describe('detectMobile', () => {
  it.each([
    ['Windows Chrome', UA.windowsChrome],
    ['macOS Safari (incl. iPadOS 13+ desktop-mode UA)', UA.macSafari],
    ['Linux Firefox', UA.linuxFirefox],
  ])('classifies %s as desktop', (_name, ua) => {
    expect(detectMobile({ ua, ...noHints })).toBe(false);
  });

  it.each([
    ['Android phone Chrome', UA.androidPhoneChrome],
    ['Android phone Firefox', UA.androidPhoneFirefox],
    ['iPhone Safari', UA.iphoneSafari],
    ['KaiOS (generic Mobi token only)', UA.kaiOs],
  ])('classifies %s as mobile', (_name, ua) => {
    expect(detectMobile({ ua, ...noHints })).toBe(true);
  });

  it.each([
    ['Android tablet Chrome', UA.androidTabletChrome],
    ['Android tablet Firefox', UA.androidTabletFirefox],
  ])('leaves %s on the desktop app', (_name, ua) => {
    expect(detectMobile({ ua, ...noHints })).toBe(false);
  });

  it('leaves a legacy iPad on the desktop app despite its Mobile UA token', () => {
    expect(detectMobile({ ua: UA.ipadSafariLegacy, ...noHints })).toBe(false);
  });

  it('trusts a userAgentData.mobile=true hint over an unrecognized UA', () => {
    expect(detectMobile({ ua: 'SomeFutureBrowser/1.0', uaDataMobile: true })).toBe(true);
  });
});

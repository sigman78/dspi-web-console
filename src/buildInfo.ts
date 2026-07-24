import { activeMockProfiles } from './mockProfiles';

export const APP_VERSION = __APP_VERSION__;
export const GIT_SHA = __GIT_SHA__;
export const BUILD_DATE = __BUILD_DATE__;

export const REPO_URL = 'https://github.com/sigman78/dspi-web-console';

export interface IssueContext {
  fwLabel?: string | null;
  serial?: string | null;
  connectionPhase?: string;
  error?: string | null;
}

export function reportIssueUrl(ctx: IssueContext = {}): string {
  const mockProfiles = activeMockProfiles();
  const mockLabel = mockProfiles
    ? ` (mock=${mockProfiles.map((p) => p.name).join('+')}, ${mockProfiles.map((p) => p.platform).join('+')})`
    : '';
  const device = ctx.fwLabel
    ? `fw ${ctx.fwLabel}${ctx.serial ? ` · serial ${ctx.serial}` : ''}`
    : 'not connected';
  const lines = [
    `**Console:** v${APP_VERSION} (${GIT_SHA}, ${BUILD_DATE})`,
    `**Browser:** ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `**Device:** ${device}`,
    `**Connection:** ${ctx.connectionPhase ?? 'unknown'}${mockLabel}`,
    ...(ctx.error ? ['', '**Diagnostics:**', '```', ctx.error, '```'] : []),
    '',
    '**What happened:**',
    '',
    '**Expected:**',
    '',
  ];
  return `${REPO_URL}/issues/new?body=${encodeURIComponent(lines.join('\n'))}`;
}

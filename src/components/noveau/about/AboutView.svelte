<script lang="ts">
  import * as BuildInfo from '@/buildInfo';
  import { LATEST_CHANGES } from '@/changelog';
  import { activeMockProfiles } from '@/mockProfiles';
  import { connection } from '@/state';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import { DESTINATION_SHORTCUTS } from '@/components/noveau/destinations';

  const s = getSession();
  const mock = activeMockProfiles();
  const usbReason = Runtime.webUsbUnsupportedReason();
  const issueUrl = $derived(BuildInfo.reportIssueUrl({
    fwLabel: s.info.capabilities.fwLabel,
    serial: s.info.serial,
    connectionPhase: connection.phase,
  }));

  type Row = { label: string; value: string; tone?: 'warn' };
  const consoleRows = $derived<Row[]>([
    { label: 'VERSION', value: `v${BuildInfo.APP_VERSION}` },
    { label: 'BUILD', value: `${BuildInfo.GIT_SHA} · ${BuildInfo.BUILD_DATE}` },
    ...(mock ? [{ label: 'MOCK', value: mock.map((p) => p.name).join(', ') }] : []),
    { label: 'WEBUSB', value: usbReason ?? 'supported', tone: usbReason ? 'warn' : undefined },
  ]);
  const hints: Row[] = [
    { label: 'KEYS', value: DESTINATION_SHORTCUTS.map((sc) => `${sc.keys.join(' / ')} ${sc.action}`).join(' · ') },
    { label: 'URL', value: '?mock · ?mock=legacy · ?mock=multi · ?mock=v<N> · &chip=rp2040 · &debug' },
    { label: 'REPORTING', value: 'Mention the page and panel when reporting an issue' },
  ];
</script>

{#snippet kv(r: Row)}
  <div class="kv">
    <span class="t-cap">{r.label}</span>
    <span class="t-value val" class:warn={r.tone === 'warn'}>{r.value}</span>
  </div>
{/snippet}

<div class="about">
  <section class="band">
    <header class="sec-h">
      <h3>DSPi CONSOLE</h3>
      <span class="links">
        <a class="chip" href={BuildInfo.REPO_URL} target="_blank" rel="noopener">GITHUB</a>
        <a class="chip" href={issueUrl} target="_blank" rel="noopener">REPORT ISSUE</a>
        <a class="chip" href={BuildInfo.FIRMWARE_URL} target="_blank" rel="noopener">FIRMWARE</a>
      </span>
    </header>
    <div class="rows">
      {#each consoleRows as r (r.label)}{@render kv(r)}{/each}
    </div>
  </section>

  <section class="band changes">
    <header class="sec-h"><h3>LATEST CHANGES</h3><span class="t-meta ver">v{LATEST_CHANGES.version}</span></header>
    <div class="fade">
      <ul>
        {#each LATEST_CHANGES.highlights as h (h)}<li>{h}</li>{/each}
      </ul>
    </div>
  </section>

  <section class="band">
    <header class="sec-h"><h3>HINTS</h3></header>
    <div class="hints">
      {#each hints as r (r.label)}{@render kv(r)}{/each}
    </div>
  </section>
</div>

<style>
  .about {
    flex: 1;
    min-width: 0;
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    row-gap: 12px;
    overflow: hidden;
  }
  .band {
    min-width: 0;
    min-height: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    overflow: hidden;
  }
  header {
    flex: none;
    padding: 0 12px;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }
  .ver { color: var(--text-dim); }
  .rows { padding: 8px 12px 10px; display: flex; flex-wrap: wrap; gap: 6px 32px; }
  .hints { padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 4px; }
  .kv {
    display: inline-flex;
    gap: 8px;
    align-items: baseline;
  }
  .val.warn { color: var(--warn); }
  .links { display: flex; gap: 6px; }
  .links .chip { text-decoration: none; }
  .changes { min-height: 0; }
  .fade { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; padding: 10px 12px; }
  .fade::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 24px;
    pointer-events: none;
    background: linear-gradient(to bottom, transparent, var(--panel));
  }
  ul {
    margin: 0;
    padding: 0 0 0 14px;
    columns: 2;
    column-gap: 32px;
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-dim);
  }
  li { break-inside: avoid; margin-bottom: 5px; }
</style>

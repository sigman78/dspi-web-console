<script lang="ts">
  import { APP_VERSION, GIT_SHA, BUILD_DATE, REPO_URL, reportIssueUrl } from '@/buildInfo';
  import { LATEST_CHANGES } from '@/changelog';
  import { activeMockProfiles } from '@/mockProfiles';
  import { connection } from '@/state';
  import * as Runtime from '@/runtime';
  import { uiVariant } from '@/devOptions';
  import { SUPPORT_WINDOW } from '@/protocol/capabilities';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const mock = activeMockProfiles();
  const usbReason = Runtime.webUsbUnsupportedReason();
  const issueUrl = $derived(reportIssueUrl({
    fwLabel: s.info.capabilities.fwLabel,
    serial: s.info.serial,
    connectionPhase: connection.phase,
  }));

  const cs = $derived(s.controlSurfaces);
  const csTooOld = $derived(cs.deviceCapsVersion != null && cs.caps == null && !cs.busy);
  const csProto = $derived(cs.deviceCapsVersion == null ? '—' : `v${cs.deviceCapsVersion}`);
  const ctrlProto = $derived(s.ctrlIfaces.status ? `v${s.ctrlIfaces.status.protoVersion}` : '—');
  const build = $derived(s.info.build);

  type Row = { label: string; value: string; tone?: 'ok' | 'off' | 'warn'; title?: string };
  const consoleRows = $derived<Row[]>([
    { label: 'VERSION', value: `v${APP_VERSION}` },
    { label: 'BUILD', value: `${GIT_SHA} · ${BUILD_DATE}` },
    { label: 'UI', value: uiVariant() },
    ...(mock ? [{ label: 'MOCK', value: mock.map((p) => p.name).join(', ') }] : []),
    { label: 'WEBUSB', value: usbReason ?? 'supported', tone: usbReason ? 'warn' : undefined },
  ]);
  const deviceRows = $derived<Row[]>([
    { label: 'STATUS', value: connection.label, tone: connection.connected ? 'ok' : 'off' },
    { label: 'SERIAL', value: s.info.serial },
    {
      label: 'FIRMWARE',
      value: s.info.capabilities.fwLabel,
      title: `Firmware releases this console supports: ${SUPPORT_WINDOW.fw}.`,
    },
    { label: 'PLATFORM', value: snap?.platform.name ?? '—' },
    { label: 'BUILD', value: build ? `${build.describe} · ${build.date}` : '—', tone: build ? undefined : 'off' },
    {
      label: 'FORMAT',
      value: s.info.capabilities.wireLabel,
      title: `Wire formats this console supports: ${SUPPORT_WINDOW.wire}.`,
    },
    { label: 'OUTPUTS', value: `${snap?.platform.outputCount ?? 0} / ${snap?.platform.totalChannelCount ?? 0}` },
    {
      label: 'CS PROTO',
      value: csProto,
      tone: csTooOld ? 'warn' : cs.deviceCapsVersion == null ? 'off' : undefined,
      title: `Control Surfaces protocol versions this console supports: v${Runtime.MIN_CS_CAPS_VERSION}–v${Runtime.MAX_KNOWN_CS_CAPS_VERSION}.`,
    },
    {
      label: 'CTRL PROTO',
      value: ctrlProto,
      tone: s.ctrlIfaces.status ? undefined : 'off',
      title: 'External control interface (UART/I2C) protocol this console knows: v1.',
    },
  ]);
</script>

{#snippet kv(r: Row)}
  <div class="kv" title={r.title}>
    <span class="lbl">{r.label}</span>
    <span class="val" class:ok={r.tone === 'ok'} class:off={r.tone === 'off'} class:warn={r.tone === 'warn'}>{r.value}</span>
  </div>
{/snippet}

<div class="about">
  <section class="col">
    <header><h3>CONSOLE</h3></header>
    <div class="rows">
      {#each consoleRows as r (r.label)}{@render kv(r)}{/each}
      <div class="kv">
        <span class="lbl">LINKS</span>
        <span class="links">
          <a class="chip" href={REPO_URL} target="_blank" rel="noopener">GITHUB</a>
          <a class="chip" href={issueUrl} target="_blank" rel="noopener">REPORT ISSUE</a>
          <a class="chip" href="https://github.com/WeebLabs/DSPi" target="_blank" rel="noopener">FIRMWARE</a>
        </span>
      </div>
    </div>
  </section>

  <section class="col">
    <header><h3>LATEST CHANGES</h3><span class="ver">v{LATEST_CHANGES.version}</span></header>
    <div class="fade">
      <ul>
        {#each LATEST_CHANGES.highlights as h (h)}<li>{h}</li>{/each}
      </ul>
    </div>
  </section>

  <section class="col">
    <header><h3>DEVICE</h3></header>
    <div class="rows">
      {#each deviceRows as r (r.label)}{@render kv(r)}{/each}
    </div>
  </section>
</div>

<style>
  .about {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    overflow: hidden;
  }
  .col {
    min-width: 0;
    box-sizing: border-box;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    overflow: hidden;
  }
  header {
    height: 28px;
    flex: none;
    box-sizing: border-box;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }
  h3 { margin: 0; font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--text); }
  .ver { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
  .rows { padding: 6px 12px 10px; display: flex; flex-direction: column; gap: 2px; }
  .kv {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 8px;
    align-items: baseline;
    min-height: 22px;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .lbl { font-size: 11px; letter-spacing: 0.06em; color: var(--text-dim); }
  .val { color: var(--text); overflow-wrap: anywhere; }
  .val.ok { color: var(--ok); }
  .val.off { color: var(--text-faint); }
  .val.warn { color: var(--warn); }
  .links { display: flex; flex-wrap: wrap; gap: 6px; }
  .links .chip { text-decoration: none; }
  .fade { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; padding: 8px 12px; }
  .fade::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 48px;
    pointer-events: none;
    background: linear-gradient(to bottom, transparent, var(--panel));
  }
  ul {
    margin: 0;
    padding: 0 0 0 14px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-dim);
  }
</style>

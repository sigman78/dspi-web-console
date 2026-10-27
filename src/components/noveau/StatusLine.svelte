<script lang="ts">
  import { connection } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { formatRateKHz } from '@/utils';
  import { REPO_URL, FIRMWARE_RELEASES_URL, reportIssueUrl } from '@/buildInfo';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import { dismiss } from '@/components/chrome/dismiss';

  const s = getSession();
  const issueUrl = $derived(reportIssueUrl({
    fwLabel: s.info.capabilities.fwLabel,
    serial: s.info.serial,
    connectionPhase: connection.phase,
  }));
  const caps = $derived(s.info.capabilities);
  const rateHz = $derived(s.telemetry.info?.sampleRateHz);
  const rate = $derived(rateHz != null ? formatRateKHz(rateHz) : '—');
  const entries = $derived(s.staging.entries);
  const applying = $derived(s.staging.applying);
  const busy = $derived(s.writes.busy);
  const staged = $derived(entries.length > 0 || applying);
  const disruptive = $derived(s.staging.disruptive);
  let listOpen = $state(false);
  const open = $derived(listOpen && entries.length > 0);
</script>

<div class="status">
  <span class="l">{caps.fwLabel} · {caps.wireLabel} · {rate} · link {s.health.degraded ? 'degraded' : 'OK'}</span>
  {#if s.health.degraded}
    <span class="degraded" role="alert">changes not sent</span>
  {/if}
  <span class="links" aria-label="Project links">
    <a href={REPO_URL} target="_blank" rel="noopener" title="Console source on GitHub" aria-label="Console source on GitHub">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 0 0-2.06 12.67c.33.06.45-.14.45-.31v-1.2c-1.81.4-2.2-.77-2.2-.77-.3-.75-.72-.95-.72-.95-.6-.4.04-.4.04-.4.65.05 1 .68 1 .68.58 1 1.53.71 1.9.54.06-.42.23-.71.41-.87-1.44-.16-2.96-.72-2.96-3.21 0-.71.25-1.29.67-1.74-.07-.17-.29-.83.06-1.72 0 0 .55-.17 1.79.66a6.2 6.2 0 0 1 3.26 0c1.24-.83 1.79-.66 1.79-.66.35.89.13 1.55.06 1.72.42.45.67 1.03.67 1.74 0 2.5-1.52 3.05-2.97 3.21.23.2.44.6.44 1.2v1.78c0 .17.12.37.46.31A6.5 6.5 0 0 0 8 1.5z" /></svg>
    </a>
    <a href={issueUrl} target="_blank" rel="noopener" title="Report an issue (pre-filled with console and device details)" aria-label="Report an issue">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" class="ln"><path d="M5.5 6.5a2.5 2.5 0 0 1 5 0v3.5a2.5 2.5 0 0 1-5 0z" /><path d="M6 4.5l-1.3-1.3M10 4.5l1.3-1.3M3 8h2.5M10.5 8H13M3.5 12l2-1.3M12.5 12l-2-1.3M6.3 5.2h3.4" /></svg>
    </a>
    <a href={FIRMWARE_RELEASES_URL} target="_blank" rel="noopener" title="DSPi firmware releases on GitHub" aria-label="Firmware releases">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" class="ln"><rect x="4.5" y="4.5" width="7" height="7" rx="1" /><path d="M6.5 1.5v3M9.5 1.5v3M6.5 11.5v3M9.5 11.5v3M1.5 6.5h3M1.5 9.5h3M11.5 6.5h3M11.5 9.5h3" /></svg>
    </a>
  </span>
  {#if staged}
    <span class="r">
      <span class="dot"></span>
      <span class="list-wrap">
        {#if open}
          <div class="pop" role="dialog" aria-label="Staged changes" use:dismiss={{ onDismiss: () => { listOpen = false; }, ignore: '.count' }}>
            {#each entries as e (e.key)}
              <div class="item">
                <span class="lbl">{e.label}</span>
                <span class="chg">{e.from}→{e.to}</span>
                <button type="button" class="x-btn" title="Discard this change" aria-label={`Discard ${e.label}`} disabled={applying} onclick={() => s.staging.discard(e.key)}>✕</button>
              </div>
            {/each}
          </div>
        {/if}
        <button type="button" class="count" aria-expanded={open} onclick={() => { listOpen = !open; }}>{entries.length} {entries.length === 1 ? 'change' : 'changes'}</button>
      </span>
      {#if disruptive}
        <span class="why" class:danger={disruptive.tone === 'danger'}>{disruptive.reason}</span>
        <ConfirmButton
          label="APPLY"
          confirmLabel="CONFIRM"
          extraClass="accent"
          tone={disruptive.tone}
          disabled={applying || busy}
          title="Applies together — brief audio mute"
          onConfirm={() => void s.staging.applyAll()}
        />
      {:else}
        <button type="button" class="chip accent" title="Applies together — brief audio mute" disabled={applying || busy} onclick={() => void s.staging.applyAll()}>APPLY</button>
      {/if}
      <ConfirmButton
        label="DISCARD"
        confirmLabel="DISCARD?"
        extraClass="hi"
        tone="warn"
        disabled={applying}
        title="Drop every staged change"
        onConfirm={() => s.staging.discardAll()}
      />
    </span>
  {:else}
    <span class="r idle"><span class="dot"></span>nothing staged</span>
  {/if}
</div>

<style>
  .status {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-top: 1px solid var(--border-hi);
    background: color-mix(in oklab, var(--surface-chrome), oklch(0% 0 0) 15%);
    position: relative;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
  }
  .l { white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .degraded { flex: none; margin-left: 16px; color: var(--warn); white-space: nowrap; font-weight: 500; }
  .links { display: flex; align-items: center; gap: 2px; margin-left: auto; margin-right: 16px; }
  .links a {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-s);
    color: var(--text-faint);
  }
  .links a:hover, .links a:focus-visible { color: var(--text); background: var(--wash); }
  .links svg { fill: currentColor; }
  .links svg.ln { fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
  .r { flex: none; display: flex; align-items: center; gap: 12px; color: var(--text-dim); font-family: var(--font-sans); }
  .list-wrap { position: relative; }
  .count {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 500;
    color: inherit;
    cursor: pointer;
  }
  .count:hover { color: var(--text); }
  .pop {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    z-index: var(--z-flyout);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 260px;
    padding: 10px;
    border-radius: var(--radius);
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    box-shadow: var(--shadow-flyout);
    font-size: 11px;
  }
  .item { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; }
  .lbl { color: var(--text); white-space: nowrap; }
  .chg { font-family: var(--font-mono); color: var(--text-dim); white-space: nowrap; }
  .why { color: var(--warn); white-space: nowrap; }
  .why.danger { color: var(--err); }
  .r.idle { color: var(--text-faint); font-family: var(--font-mono); gap: 8px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
  .idle .dot { background: var(--text-faint); opacity: var(--dim-off); }
</style>

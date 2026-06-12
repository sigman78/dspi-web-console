<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import { TAB_SHORTCUTS } from '@/input/tabShortcuts';
  import { REPO_URL, reportIssueUrl } from '@/buildInfo';
  import { connection, activeSession } from '@/state';

  const s = $derived(activeSession());
  const issueUrl = $derived(reportIssueUrl({
    fwLabel: s?.device?.info.capabilities.fwLabel ?? null,
    serial: s?.device?.info.serial ?? null,
    connectionPhase: connection.phase,
    error: connection.error,
  }));
</script>

<Panel code="OV.05" title="QUICK REFERENCE">
  <div class="body">
    <div class="keys">
      {#each TAB_SHORTCUTS as sc (sc.action)}
        <span class="sc">
          {#each sc.keys as k (k)}
            <span class="kbd">{k}</span>
          {/each}
          <span class="action">{sc.action}</span>
        </span>
      {/each}
    </div>
    <div class="hint">
      Panel codes (OV.01, SY.02 …) identify panels — mention them when reporting issues.
    </div>
    <div class="links">
      <a href={REPO_URL} target="_blank" rel="noreferrer">GITHUB ↗</a>
      <a href={issueUrl} target="_blank" rel="noreferrer">REPORT ISSUE ↗</a>
    </div>
  </div>
</Panel>

<style>
  .body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-family: var(--font-mono);
  }
  .keys {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 6px 14px;
  }
  .sc {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .sc:last-child { grid-column: 1 / -1; }
  .kbd {
    flex-shrink: 0;
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid var(--border-hi);
    background: color-mix(in oklab, var(--text) 5%, transparent);
    color: var(--text-dim);
    letter-spacing: 0.5px;
  }
  .action {
    font-size: 9px;
    letter-spacing: 1px;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    font-family: var(--font-sans);
    font-size: 10px;
    color: var(--text-faint);
    line-height: 1.5;
  }
  .links {
    display: flex;
    gap: 14px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .links a {
    font-size: 9px;
    letter-spacing: 1px;
    color: var(--accent);
    text-decoration: none;
  }
  .links a:hover { text-decoration: underline; }
</style>

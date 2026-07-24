<script lang="ts">
  import {
    sessionRecords, activeRecord, adoptFailures, adoptionInProgress, clearAdoptFailure,
    type ConnId, type DeviceRecord, type AdoptFailure,
  } from '@/state';
  import { activateSession, connectRequested, webUsbUnsupportedReason } from '@/runtime';

  // Guards a switch in flight so a second click can't re-enter activateSession
  // for a different target while the first switch's flush/reconcile is still
  // awaiting.
  let switching = $state(false);

  const records = $derived(sessionRecords());
  const failures = $derived(adoptFailures());
  const activeId = $derived(activeRecord()?.id ?? null);
  const unsupported = $derived(webUsbUnsupportedReason() !== null);
  const empty = $derived(records.size === 0 && failures.size === 0);

  function rowTitle(rec: DeviceRecord): string {
    return `${rec.session.info.serial} · ${rec.session.hardware.name}`;
  }

  function badgeTitle(failure: AdoptFailure): string {
    const hint = failure.errorKind === 'device-in-use' ? ' (device in use)'
      : failure.errorKind === 'unsupported-firmware' ? ' (firmware update required)'
      : '';
    return `${failure.message}${hint}`;
  }

  async function onRowClick(id: ConnId, active: boolean): Promise<void> {
    if (active || switching || adoptionInProgress()) return;
    switching = true;
    try {
      await activateSession(id);
    } finally {
      switching = false;
    }
  }

  async function onAdd(): Promise<void> {
    if (switching || adoptionInProgress()) return;
    try {
      await connectRequested();
    } catch {
      // connectRequested already reported the failure (hero, badge, or notice).
    }
  }
</script>

{#if !empty}
  <div class="devices" role="group" aria-label="Devices">
    <div class="head">
      <div class="microlbl">DEVICES</div>
      {#if !unsupported}
        <button
          class="add"
          title="Add device…"
          aria-label="Add device"
          disabled={switching || adoptionInProgress()}
          onclick={onAdd}
        >+</button>
      {/if}
    </div>
    {#each records.values() as rec (rec.id)}
      {@const active = rec.id === activeId}
      <button
        class="row device"
        class:active
        aria-pressed={active}
        disabled={!active && (switching || adoptionInProgress())}
        title={rowTitle(rec)}
        onclick={() => onRowClick(rec.id, active)}
      >
        <span class="serial">{rec.session.info.serial}</span>
        <span class="hw">{rec.session.hardware.name}</span>
      </button>
    {/each}
    {#each failures.values() as failure (failure.serial)}
      <button
        class="row badge"
        title={badgeTitle(failure)}
        aria-label={`Adoption failed: ${failure.serial} — dismiss`}
        onclick={() => clearAdoptFailure(failure.serial)}
      >
        <span class="serial">{failure.serial}</span>
        <span class="hw">FAILED</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .devices {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .add {
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
    border-radius: var(--radius-m);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
  }
  .add:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .add:disabled { opacity: var(--dim-disabled); cursor: default; }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-align: left;
    border-radius: var(--radius-m);
    border: 1px solid var(--border);
    background: var(--wash);
    color: var(--text-dim);
    cursor: pointer;
  }
  .row:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .row:disabled { opacity: var(--dim-disabled); cursor: default; }

  .serial {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .hw {
    flex: none;
    font-weight: 400;
    font-size: 8px;
    letter-spacing: 1px;
    color: var(--text-faint);
  }

  .row.device.active {
    --tone: var(--accent);
    background: color-mix(in oklab, var(--tone) 14%, transparent);
    border-color: color-mix(in oklab, var(--tone) 50%, var(--border));
    color: var(--tone);
  }
  .row.device.active .hw { color: color-mix(in oklab, var(--tone) 70%, var(--text-faint)); }

  .row.badge {
    --tone: var(--err);
    background: color-mix(in oklab, var(--tone) 10%, transparent);
    border-color: color-mix(in oklab, var(--tone) 50%, var(--border));
    color: var(--tone);
  }
  .row.badge .hw { color: color-mix(in oklab, var(--tone) 70%, var(--text-faint)); }
  .row.badge:hover:not(:disabled) {
    color: var(--tone);
    background: color-mix(in oklab, var(--tone) 18%, transparent);
    border-color: var(--tone);
  }
</style>

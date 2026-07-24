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

  function chipTitle(rec: DeviceRecord): string {
    return `${rec.session.info.serial} · ${rec.session.hardware.name}`;
  }

  function badgeTitle(failure: AdoptFailure): string {
    const hint = failure.errorKind === 'device-in-use' ? ' (device in use)'
      : failure.errorKind === 'unsupported-firmware' ? ' (firmware update required)'
      : '';
    return `${failure.message}${hint}`;
  }

  async function onChipClick(id: ConnId, active: boolean): Promise<void> {
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
      // connectRequested already reported the failure (hero or badge).
    }
  }
</script>

{#if !empty}
  <div class="switcher" role="group" aria-label="Devices">
    {#each records.values() as rec (rec.id)}
      {@const active = rec.id === activeId}
      <button
        class="chip device"
        class:active
        aria-pressed={active}
        disabled={!active && (switching || adoptionInProgress())}
        title={chipTitle(rec)}
        onclick={() => onChipClick(rec.id, active)}
      >{rec.session.info.serial}</button>
    {/each}
    {#each failures.values() as failure (failure.serial)}
      <button
        class="chip badge"
        title={badgeTitle(failure)}
        aria-label={`Adoption failed: ${failure.serial} — dismiss`}
        onclick={() => clearAdoptFailure(failure.serial)}
      >{failure.serial}</button>
    {/each}
    {#if !unsupported}
      <button
        class="chip add"
        title="Add device…"
        aria-label="Add device"
        disabled={switching || adoptionInProgress()}
        onclick={onAdd}
      >+</button>
    {/if}
  </div>
{/if}

<style>
  .switcher {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
  }
  .chip {
    height: 20px;
    display: inline-flex;
    align-items: center;
    padding: 0 8px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    border-radius: var(--radius-m);
    border: 1px solid var(--border);
    background: var(--wash);
    color: var(--text-dim);
    cursor: pointer;
  }
  .chip:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .chip:disabled { opacity: var(--dim-disabled); cursor: default; }

  .chip.device {
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip.device.active {
    --tone: var(--accent);
    background: color-mix(in oklab, var(--tone) 14%, transparent);
    border-color: color-mix(in oklab, var(--tone) 50%, var(--border));
    color: var(--tone);
    opacity: 1;
  }

  .chip.badge {
    --tone: var(--err);
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: color-mix(in oklab, var(--tone) 10%, transparent);
    border-color: color-mix(in oklab, var(--tone) 50%, var(--border));
    color: var(--tone);
  }
  .chip.badge:hover:not(:disabled) {
    color: var(--tone);
    background: color-mix(in oklab, var(--tone) 18%, transparent);
    border-color: var(--tone);
  }

  .chip.add {
    width: 20px;
    padding: 0;
    justify-content: center;
    font-size: 11px;
  }

  @media (max-width: 1480px) {
    .chip.device, .chip.badge { max-width: 8ch; }
  }
</style>

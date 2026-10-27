<script lang="ts">
  import {
    sessionRecords, activeRecord, adoptFailures, adoptionInProgress, clearAdoptFailure,
    type ConnId, type DeviceRecord, type AdoptFailure,
  } from '@/state';
  import { switchSession, connectRequested, webUsbUnsupportedReason } from '@/runtime';
  import { dismiss } from './dismiss';

  type Entry =
    | { kind: 'device'; id: ConnId; rec: DeviceRecord }
    | { kind: 'badge'; id: string; failure: AdoptFailure };

  // Three rows overflow the channel rail at the 1440x790 floor with every output enabled.
  const MAX_VISIBLE = 2;

  // Guards a switch in flight so a second click can't re-enter activateSession
  // for a different target while the first switch's flush/reconcile is still
  // awaiting.
  let switching = $state(false);

  const records = $derived(sessionRecords());
  const failures = $derived(adoptFailures());
  const activeId = $derived(activeRecord()?.id ?? null);
  const unsupported = $derived(webUsbUnsupportedReason() !== null);
  const empty = $derived(records.size === 0 && failures.size === 0);
  let moreOpen = $state(false);

  // Active device first, then failure badges, then the rest, so neither the
  // active row nor a failure is ever pushed behind the overflow.
  const entries = $derived<Entry[]>([
    ...[...records.values()].filter((rec) => rec.id === activeId).map((rec): Entry => ({ kind: 'device', id: rec.id, rec })),
    ...[...failures.values()].map((failure): Entry => ({ kind: 'badge', id: failure.serial, failure })),
    ...[...records.values()].filter((rec) => rec.id !== activeId).map((rec): Entry => ({ kind: 'device', id: rec.id, rec })),
  ]);
  const visible = $derived(entries.slice(0, MAX_VISIBLE));
  const hidden = $derived(entries.slice(MAX_VISIBLE));
  const hiddenFailed = $derived(hidden.some((e) => e.kind === 'badge'));
  $effect(() => { if (hidden.length === 0) moreOpen = false; });

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
      await switchSession(id);
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

{#snippet row(entry: Entry)}
  {#if entry.kind === 'device'}
    {@const active = entry.id === activeId}
    <button
      class="row device"
      class:active
      aria-pressed={active}
      disabled={!active && (switching || adoptionInProgress())}
      title={rowTitle(entry.rec)}
      onclick={() => { moreOpen = false; void onRowClick(entry.id, active); }}
    >
      <span class="serial">{entry.rec.session.info.serial}</span>
      <span class="hw">{entry.rec.session.hardware.name}</span>
    </button>
  {:else}
    <button
      class="row badge"
      title={badgeTitle(entry.failure)}
      aria-label={`Adoption failed: ${entry.failure.serial} — dismiss`}
      onclick={() => clearAdoptFailure(entry.failure.serial)}
    >
      <span class="serial">{entry.failure.serial}</span>
      <span class="hw">FAILED</span>
    </button>
  {/if}
{/snippet}

{#if !empty}
  <div class="devices" role="group" aria-label="Devices">
    <div class="head">
      <div class="microlbl">DEVICES</div>
      <div class="tools">
        {#if hidden.length > 0}
          <button
            class="more"
            class:warn={hiddenFailed}
            title={`${hidden.length} more`}
            aria-label={`${hidden.length} more devices${hiddenFailed ? ', including failed' : ''}`}
            aria-expanded={moreOpen}
            onclick={() => { moreOpen = !moreOpen; }}
          >+{hidden.length}</button>
        {/if}
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
    </div>
    {#each visible as entry (`${entry.kind}:${entry.id}`)}
      {@render row(entry)}
    {/each}
    {#if moreOpen && hidden.length > 0}
      <div class="pop" role="dialog" aria-label="More devices" use:dismiss={{ onDismiss: () => { moreOpen = false; }, ignore: '.more' }}>
        {#each hidden as entry (`${entry.kind}:${entry.id}`)}
          {@render row(entry)}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .devices {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tools { display: flex; align-items: center; gap: 4px; }
  .add, .more {
    min-width: 16px;
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
  .more { padding: 0 4px; font-size: 9px; font-weight: 700; }
  .more.warn {
    color: var(--warn);
    border-color: color-mix(in oklab, var(--warn) var(--tint-edge), var(--border));
    background: color-mix(in oklab, var(--warn) var(--tint), transparent);
  }
  .add:hover:not(:disabled), .more:hover { color: var(--text); border-color: var(--border-hi); }
  .add:disabled { opacity: var(--dim-disabled); cursor: default; }
  .pop {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: var(--z-flyout);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    border-radius: var(--radius);
    background: var(--panel-solid);
    border: 1px solid var(--border-hi);
    box-shadow: var(--shadow-flyout);
  }

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
    background: color-mix(in oklab, var(--tone) var(--tint), transparent);
    border-color: color-mix(in oklab, var(--tone) 50%, var(--border));
    color: var(--tone);
  }
  .row.device.active .hw { color: color-mix(in oklab, var(--tone) 70%, var(--text-faint)); }

  .row.badge {
    --tone: var(--err);
    background: color-mix(in oklab, var(--tone) var(--tint), transparent);
    border-color: color-mix(in oklab, var(--tone) 50%, var(--border));
    color: var(--tone);
  }
  .row.badge .hw { color: color-mix(in oklab, var(--tone) 70%, var(--text-faint)); }
  .row.badge:hover:not(:disabled) {
    color: var(--tone);
    background: color-mix(in oklab, var(--tone) var(--tint-strong), transparent);
    border-color: var(--tone);
  }
</style>

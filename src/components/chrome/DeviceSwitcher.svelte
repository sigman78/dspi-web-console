<script lang="ts">
  import * as State from '@/state';
  import type { ConnId, DeviceRecord, AdoptFailure } from '@/state';
  import { switchSession, connectRequested, webUsbUnsupportedReason } from '@/runtime';
  import { dismiss } from './dismiss';
  import * as Relay from '@/runtime/remote/relay';
  import * as JoinRelay from '@/runtime/remote/joinRelay';
  import RemoteIcon from '@/components/remote/RemoteIcon.svelte';
  import ShareDevicePopover from '@/components/remote/ShareDevicePopover.svelte';
  import JoinRemotePopover from '@/components/remote/JoinRemotePopover.svelte';

  type Entry =
    | { kind: 'device'; id: ConnId; rec: DeviceRecord }
    | { kind: 'badge'; id: string; failure: AdoptFailure };

  // Three rows overflow the channel rail at the 1440x790 floor with every output enabled.
  const MAX_VISIBLE = 2;

  // Guards a switch in flight so a second click can't re-enter activateSession
  // for a different target while the first switch's flush/reconcile is still
  // awaiting.
  let switching = $state(false);

  const records = $derived(State.sessionRecords());
  const failures = $derived(State.adoptFailures());
  const activeId = $derived(State.activeRecord()?.id ?? null);
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

  const relayOn = Relay.remoteRelayBase() !== null;
  const sharing = $derived(State.shareState() !== 'idle');
  let shareOpen = $state(false);
  let joinOpen = $state(false);
  let joinBtn = $state<HTMLButtonElement>();
  let joinFly = $state<HTMLDivElement>();
  let joinSeed = $state<State.PendingJoin | null>(null);

  // A `?join=` link seen at boot opens the join popover with its code filled in.
  $effect(() => {
    if (State.pendingJoin() === null) return;
    joinSeed = JoinRelay.takePendingJoin();
    shareOpen = false;
    joinOpen = joinSeed !== null;
  });

  // Why sharing stopped on its own, whether or not the share popover is open.
  $effect(() => {
    if (State.shareEnd() === null) return;
    State.pushNotice('warn', 'Sharing stopped: the connection to the relay was lost');
    State.setShareEnd(null);
    shareOpen = false;
  });

  function toggleShare(): void {
    moreOpen = false;
    joinOpen = false;
    shareOpen = !shareOpen;
  }

  // Focus goes back to the trigger when it was inside the popover.
  function closeJoin(): void {
    const hadFocus = joinFly?.contains(document.activeElement) ?? false;
    joinOpen = false;
    if (hadFocus) joinBtn?.focus();
  }

  function toggleJoin(): void {
    moreOpen = false;
    shareOpen = false;
    joinSeed = null;
    joinOpen = !joinOpen;
  }

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
    if (active || switching || State.adoptionInProgress()) return;
    switching = true;
    try {
      await switchSession(id);
    } finally {
      switching = false;
    }
  }

  async function onAdd(): Promise<void> {
    if (switching || State.adoptionInProgress() || sharing) return;
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
    {@const remote = entry.rec.remote !== undefined}
    {@const shareable = relayOn && active && !remote}
    <div class="line">
      <button
        class="row device"
        class:active
        class:with-tool={shareable}
        aria-pressed={active}
        disabled={!active && (switching || State.adoptionInProgress() || sharing)}
        title={!active && sharing ? 'Stop sharing to switch devices' : rowTitle(entry.rec)}
        onclick={() => { moreOpen = false; void onRowClick(entry.id, active); }}
      >
        <span class="serial">{entry.rec.session.info.serial}</span>
        {#if remote}<span class="remote"><RemoteIcon icon="link" size={11} />(remote)</span>{/if}
        <span class="hw">{entry.rec.session.hardware.name}</span>
      </button>
      {#if shareable}
        <button
          type="button"
          class="tool share-btn"
          class:live={sharing}
          title={sharing ? 'Sharing this device' : 'Share this device'}
          aria-label="Share this device"
          aria-expanded={shareOpen}
          onclick={toggleShare}
        ><RemoteIcon icon="share" size={12} /></button>
      {/if}
    </div>
  {:else}
    <button
      class="row badge"
      title={badgeTitle(entry.failure)}
      aria-label={`Adoption failed: ${entry.failure.serial} — dismiss`}
      onclick={() => State.clearAdoptFailure(entry.failure.serial)}
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
        {#if relayOn}
          <button
            class="add join-btn"
            bind:this={joinBtn}
            title="Connect to a remote device…"
            aria-label="Connect to a remote device"
            aria-expanded={joinOpen}
            onclick={toggleJoin}
          ><RemoteIcon icon="link" size={11} /></button>
        {/if}
        {#if !unsupported}
          <button
            class="add"
            title={sharing ? 'Stop sharing to add a device' : 'Add device…'}
            aria-label="Add device"
            disabled={switching || State.adoptionInProgress() || sharing}
            onclick={onAdd}
          >+</button>
        {/if}
      </div>
    </div>
    {#each visible as entry (`${entry.kind}:${entry.id}`)}
      {@render row(entry)}
    {/each}
    {#if shareOpen}
      <div class="fly">
        <ShareDevicePopover onClose={() => { shareOpen = false; }} ignore=".share-btn" />
      </div>
    {/if}
    {#if joinOpen}
      <div class="fly" bind:this={joinFly}>
        <JoinRemotePopover seed={joinSeed} onClose={closeJoin} ignore=".join-btn" />
      </div>
    {/if}
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

  /* Right of the rail, like the presets flyout (the rail head pads 10px). */
  .fly {
    position: absolute;
    left: calc(100% + 16px);
    top: 0;
    z-index: var(--z-flyout);
  }
  .line { position: relative; display: flex; }
  .row.with-tool { padding-right: 28px; }
  .tool {
    position: absolute;
    top: 50%;
    right: 4px;
    width: 18px;
    height: 18px;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: var(--radius-s);
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .tool:hover { border-color: var(--border-hi); }
  .tool.live {
    color: var(--accent);
    background: color-mix(in oklab, var(--accent) var(--tint-strong), transparent);
    border-color: var(--accent);
  }
  .remote {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: none;
    font-weight: 400;
    letter-spacing: 0.5px;
    color: var(--text-faint);
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
    margin-left: auto;
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

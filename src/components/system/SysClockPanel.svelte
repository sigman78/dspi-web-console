<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import ConfirmButton from '@/components/chrome/ConfirmButton.svelte';
  import { connection } from '@/state';
  import { applySysClock, refreshSysClock } from '@/runtime';
  import * as Domain from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const st = $derived(s.sysClock.status);
  const connected = $derived(connection.connected);
  // Restrictive default: a not-yet-landed mirror must not offer RP2350-only
  // bench voltages on what may be an RP2040.
  const platform = $derived(s.mirror.current?.platform.type ?? Domain.PlatformType.RP2040);
  const ceiling = $derived(
    platform === Domain.PlatformType.RP2350 ? Domain.SYS_CLOCK_VREG_CEILING_RP2350 : Domain.SYS_CLOCK_VREG_CEILING_RP2040,
  );

  // Local edits override the device-derived selection. They are held through
  // the whole apply (so the controls keep showing the user's intent, not the
  // mid-apply device state) and cleared only once the device confirms the
  // stored setting matches -- after a rejected SET the selection survives for
  // the user to adjust.
  let modeOverride = $state<Domain.SysClockMode | null>(null);
  let vregOverride = $state<number | null>(null);

  const pendingMode = $derived(modeOverride ?? st?.storedMode ?? Domain.SysClockMode.Mhz307p2);
  const pendingVreg = $derived(vregOverride ?? st?.storedVregSel ?? Domain.SYS_CLOCK_VREG_DEFAULT);

  const modeOptions = Domain.SYS_CLOCK_MODE_MHZ.map((mhz, mode) => ({
    value: mode as Domain.SysClockMode,
    label: Number.isInteger(mhz) ? String(mhz) : mhz.toFixed(1),
  }));

  const voltageOptions = $derived.by(() => {
    const defaultVreg = Domain.SYS_CLOCK_MODE_DEFAULT_VREG[pendingMode];
    const opts: { value: number; label: string }[] = [
      { value: Domain.SYS_CLOCK_VREG_DEFAULT, label: `DEFAULT (${Domain.sysClockVregVolts(defaultVreg).toFixed(2)} V)` },
    ];
    for (let sel = defaultVreg; sel <= ceiling; sel++) {
      const volts = Domain.sysClockVregVolts(sel).toFixed(2);
      opts.push({ value: sel, label: sel >= Domain.SYS_CLOCK_VREG_BENCH_MIN ? `${volts} V — BENCH` : `${volts} V` });
    }
    return opts;
  });

  const activeLabel = $derived(st ? `${Domain.SYS_CLOCK_MODE_MHZ[st.activeMode]} MHz @ ${Domain.sysClockVregVolts(st.liveVreg).toFixed(2)} V` : '—');
  const storedLabel = $derived(st
    ? `${Domain.SYS_CLOCK_MODE_MHZ[st.storedMode]} MHz${st.storedVregSel === Domain.SYS_CLOCK_VREG_DEFAULT ? ' (default)' : ` @ ${Domain.sysClockVregVolts(st.storedVregSel).toFixed(2)} V`}`
    : '—');
  const pendingApply = $derived(st != null && st.activeMode !== st.storedMode && !st.fallbackActive);

  const isOverclock = $derived(pendingMode > Domain.SysClockMode.Mhz307p2);
  const disabledReason = $derived(
    !connected ? 'Connect a device to enable this action.'
    : s.sysClock.busy ? 'A system clock change is already applying.'
    : st && pendingMode === st.storedMode && pendingVreg === st.storedVregSel ? 'Select a different clock mode or voltage first.'
    : undefined,
  );

  function onModeChange(mode: Domain.SysClockMode) {
    const defaultVreg = Domain.SYS_CLOCK_MODE_DEFAULT_VREG[mode];
    if (pendingVreg !== Domain.SYS_CLOCK_VREG_DEFAULT && pendingVreg < defaultVreg) {
      vregOverride = Domain.SYS_CLOCK_VREG_DEFAULT;
    }
    modeOverride = mode;
  }

  function onVregChange(e: Event) {
    vregOverride = Number((e.currentTarget as HTMLSelectElement).value);
  }

  async function sendAndSettle(mode: Domain.SysClockMode, vreg: number) {
    await applySysClock(s, mode, vreg);
    const now = s.sysClock.status;
    if (now && now.storedMode === mode && now.storedVregSel === vreg) {
      modeOverride = null;
      vregOverride = null;
    }
  }

  function onApply() {
    void sendAndSettle(pendingMode, pendingVreg);
  }

  function onRetry() {
    if (!st) return;
    void sendAndSettle(st.storedMode, st.storedVregSel);
  }

  function onRevert() {
    void sendAndSettle(Domain.SysClockMode.Mhz307p2, Domain.SYS_CLOCK_VREG_DEFAULT);
  }
</script>

{#if st}
  <Panel code="SY.13" title="SYSTEM CLOCK">
    {#snippet right()}
      <button
        class="chip"
        onclick={() => void refreshSysClock(s)}
        disabled={!connected || s.sysClock.busy}
        title="Re-read the system clock status from the device"
      >REFRESH</button>
    {/snippet}
    {#if st.fallbackActive}
      <div class="fallback-banner" role="alert" aria-label="System clock fallback">
        <div class="fallback-banner__header">CRASH FALLBACK</div>
        <p>Configured {Domain.SYS_CLOCK_MODE_MHZ[st.storedMode]} MHz failed to boot — running safe {Domain.SYS_CLOCK_MODE_MHZ[Domain.SysClockMode.Mhz307p2]} MHz.</p>
        <div class="fallback-actions">
          <button class="chip warn" onclick={onRetry} disabled={!connected || s.sysClock.busy}>RETRY</button>
          <button class="chip" onclick={onRevert} disabled={!connected || s.sysClock.busy}>REVERT</button>
        </div>
      </div>
    {/if}

    <div class="rows">
      <div class="row">
        <span class="microlbl">MODE</span>
        <SegmentedSelect
          size="sm"
          value={pendingMode}
          options={modeOptions}
          ariaLabel="System clock mode"
          disabled={!connected || s.sysClock.busy}
          onChange={onModeChange}
        />
      </div>

      <div class="row">
        <span class="microlbl">VOLTAGE</span>
        <select
          class="voltsel"
          disabled={!connected || s.sysClock.busy}
          aria-label="Core voltage"
          value={String(pendingVreg)}
          onchange={onVregChange}
        >
          {#each voltageOptions as opt (opt.value)}
            <option value={String(opt.value)}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="row apply-row">
        <ConfirmButton
          label="APPLY"
          confirmLabel="CONFIRM — AUDIO MUTES BRIEFLY"
          tone={isOverclock ? 'danger' : 'warn'}
          toneAlways
          onConfirm={onApply}
          disabled={disabledReason != null}
          disabledReason={disabledReason}
          title="Applies the selected system clock. Audio mutes briefly while the device reboots the clock."
        />
      </div>
    </div>

    <div class="kvgrid">
      <KV label="ACTIVE" value={activeLabel} />
      <KV label="STORED" value={storedLabel} tone={pendingApply ? 'warn' : undefined} />
    </div>
    {#if pendingApply}
      <p class="hint pending">Stored setting hasn't taken effect yet — the device may still be applying it.</p>
    {/if}

    <p class="hint">
      384/480 MHz overclocks the RP2 core — stability isn't guaranteed on every unit. Raising core voltage increases heat.
      {#if platform === Domain.PlatformType.RP2350} 1.35–1.50 V is bench-only.{/if}
    </p>
  </Panel>
{/if}

<style>
  .rows { padding: 14px; display: grid; grid-template-columns: 4.5rem max-content; gap: 10px 10px; align-items: center; }
  .row { display: contents; }
  .apply-row { display: flex; grid-column: 1 / -1; justify-content: flex-end; margin-top: 2px; }
  .voltsel {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .voltsel:disabled { opacity: var(--dim-disabled); cursor: default; }
  .hint { padding: 0 14px 12px; }
  .hint.pending { color: var(--warn); padding-top: 4px; }
  .fallback-banner {
    margin: 12px 14px 0;
    border: 1px solid color-mix(in oklab, var(--warn) 55%, var(--border));
    background: color-mix(in oklab, var(--warn) 8%, var(--panel));
    border-radius: var(--radius);
    overflow: hidden;
  }
  .fallback-banner__header {
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 2px;
    color: var(--warn);
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    border-bottom: 1px solid color-mix(in oklab, var(--warn) 35%, var(--border));
  }
  .fallback-banner p {
    margin: 0;
    padding: 10px 12px 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text);
  }
  .fallback-actions {
    display: flex;
    gap: 8px;
    padding: 6px 12px 12px;
  }
</style>

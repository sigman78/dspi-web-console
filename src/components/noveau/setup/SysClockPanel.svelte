<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { applySysClock, refreshSysClock, stageSysClockMode, stageSysClockVreg } from '@/runtime';
  import * as Domain from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();

  const st = $derived(s.sysClock.status);
  // Restrictive default: a not-yet-landed mirror must not offer RP2350-only
  // bench voltages on what may be an RP2040.
  const platform = $derived(s.mirror.current?.platform.type ?? Domain.PlatformType.RP2040);
  const ceiling = $derived(
    platform === Domain.PlatformType.RP2350 ? Domain.SYS_CLOCK_VREG_CEILING_RP2350 : Domain.SYS_CLOCK_VREG_CEILING_RP2040,
  );

  const pendingMode = $derived(s.staging.valueOf<Domain.SysClockMode>('sysClock:mode', st?.storedMode ?? Domain.SysClockMode.Mhz307p2));
  const pendingVreg = $derived(s.staging.valueOf('sysClock:vreg', st?.storedVregSel ?? Domain.SYS_CLOCK_VREG_DEFAULT));

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

  function onVregChange(e: Event) {
    stageSysClockVreg(s, Number((e.currentTarget as HTMLSelectElement).value));
  }

  function onRetry() {
    if (!st) return;
    void applySysClock(s, st.storedMode, st.storedVregSel);
  }

  function onRevert() {
    void applySysClock(s, Domain.SysClockMode.Mhz307p2, Domain.SYS_CLOCK_VREG_DEFAULT);
  }
</script>

{#if s.sysClock.supported !== false}
<Panel title="OVERCLOCK">
    {#snippet right()}
      {#if st}<button
        class="chip"
        onclick={() => void refreshSysClock(s)}
        disabled={s.sysClock.busy}
        title="Re-read the system clock status from the device"
      >REFRESH</button>{/if}
    {/snippet}
    {#if !st}
      <div class="waiting">
        <p class="hint idle">Waiting for clock status…</p>
        <button
          type="button"
          class="chip"
          onclick={() => void refreshSysClock(s)}
          disabled={s.sysClock.busy}
          title="Re-read the system clock status from the device"
        >RETRY</button>
      </div>
    {:else}
    {#if st.fallbackActive}
      <div class="fallback-banner" role="alert" aria-label="System clock fallback">
        <div class="fallback-banner__header">CRASH FALLBACK</div>
        <p>Configured {Domain.SYS_CLOCK_MODE_MHZ[st.storedMode]} MHz failed to boot — running safe {Domain.SYS_CLOCK_MODE_MHZ[Domain.SysClockMode.Mhz307p2]} MHz.</p>
        <div class="fallback-actions">
          <button class="chip warn" onclick={onRetry} disabled={s.sysClock.busy}>RETRY</button>
          <button class="chip" onclick={onRevert} disabled={s.sysClock.busy}>REVERT</button>
        </div>
      </div>
    {/if}

    <div class="rows">
      <div class="row">
        <span class="microlbl">MODE</span>
        <span class="stage-wrap" class:staged={s.staging.has('sysClock:mode')}>
          <SegmentedSelect
            value={pendingMode}
            options={modeOptions}
            ariaLabel="System clock mode"
            disabled={s.sysClock.busy}
            onChange={(m) => stageSysClockMode(s, m)}
          />
        </span>
      </div>

      <div class="row">
        <span class="microlbl">VOLTAGE</span>
        <span class="stage-wrap" class:staged={s.staging.has('sysClock:vreg')}>
          <select
            class="voltsel"
            disabled={s.sysClock.busy}
            aria-label="Core voltage"
            value={String(pendingVreg)}
            onchange={onVregChange}
          >
            {#each voltageOptions as opt (opt.value)}
              <option value={String(opt.value)}>{opt.label}</option>
            {/each}
          </select>
        </span>
      </div>
    </div>

    <div class="kvrows">
      <KV inline label="ACTIVE" value={activeLabel} />
      <KV inline label="STORED" value={storedLabel} tone={pendingApply ? 'warn' : undefined} />
    </div>
    {#if pendingApply}
      <p class="hint pending">Stored setting hasn't taken effect yet — the device may still be applying it.</p>
    {/if}

    <p class="hint">
      384/480 MHz overclocks the RP2 core — stability isn't guaranteed on every unit. Raising core voltage increases heat.
      {#if platform === Domain.PlatformType.RP2350} 1.35–1.50 V is bench-only.{/if}
    </p>
    {/if}
  </Panel>
{/if}

<style>
  .rows { padding: 14px; display: grid; grid-template-columns: 4.5rem max-content; gap: 10px 10px; align-items: center; }
  .row { display: contents; }
  .voltsel {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    cursor: pointer;
  }
  .voltsel:disabled { opacity: var(--dim-disabled); cursor: default; }
  .hint { padding: 0 14px 12px; }
  .waiting { display: flex; align-items: center; gap: 8px; padding-right: 14px; }
  .waiting .hint { padding-bottom: 0; flex: 1; }
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
    font-family: var(--font-sans);
    font-size: var(--fs-m);
    font-weight: 600;
    color: var(--warn);
    background: color-mix(in oklab, var(--warn) var(--tint), transparent);
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

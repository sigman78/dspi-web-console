<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import * as Domain from '@/domain';
  import { getSession } from '@/components/sessionContext';

  const ROLE_LEGEND: Record<Domain.PinRole, string> = {
    'audio-out': 'OUTPUTS',
    'audio-in': 'INPUTS',
    clock: 'CLOCKS',
    control: 'CONTROL IF',
    surface: 'SURFACES',
    system: 'SYSTEM',
  };
  const ROLE_ORDER = Object.keys(ROLE_LEGEND) as Domain.PinRole[];

  interface Cell {
    pin: number;
    assignable: boolean;
    adc: boolean;
    use: Domain.PinUse | null;
  }

  const s = getSession();

  const snap = $derived(s.mirror.current);
  const ctrlPins = $derived({ uart: s.ctrlIfaces.uart, i2c: s.ctrlIfaces.i2c, cs: Domain.liveCsPinConfigs(s.controlSurfaces.bindings, s.controlSurfaces.status) });

  const platformType = $derived(snap?.platform.type ?? Domain.PlatformType.RP2350);
  const channelModel = $derived(snap?.platform.channelModel ?? Domain.ChannelFamily.Legacy);
  const uses = $derived(snap ? Domain.pinUses(snap, ctrlPins) : null);

  const cells = $derived<Cell[]>(
    snap
      ? Array.from({ length: Domain.maxGpio(platformType) + 1 }, (_, pin) => ({
          pin,
          assignable: Domain.isAssignablePin(platformType, pin, channelModel),
          adc: Domain.CS_ADC_PINS.includes(pin),
          use: uses?.get(pin) ?? null,
        }))
      : [],
  );

  const rolesPresent = $derived(new Set(uses ? Array.from(uses.values(), (u) => u.role) : []));

  // Pin 12 is only the legacy debug UART pre-V16; the 23-25 range is a fixed
  // board reservation on every generation.
  function reservedTooltip(pin: number): string {
    if (pin === 12 && channelModel === Domain.ChannelFamily.Legacy) return 'GP12 · debug UART (fw 1.1.4)';
    if (pin >= 23 && pin <= 25) return `GP${pin} · reserved (board)`;
    return `GP${pin} · reserved`;
  }

  function tooltipFor(cell: Cell): string {
    if (cell.use) return `GP${cell.pin} · ${cell.use.label} · ${ROLE_LEGEND[cell.use.role]}`;
    if (!cell.assignable) return reservedTooltip(cell.pin);
    return `GP${cell.pin} · free${cell.adc ? ' · ADC-capable' : ''}`;
  }
</script>

<Panel code="SY.16" title="PIN MAP">
  {#if snap}
    <div class="grid">
      {#each cells as cell (cell.pin)}
        <div
          class="cell {cell.use ? `pinrole-${cell.use.role}` : ''}"
          class:used={!!cell.use}
          class:reserved={!cell.assignable}
          title={tooltipFor(cell)}
        >
          {#if cell.adc}<span class="adc-mark">▪</span>{/if}
          <span class="num">GP{cell.pin}</span>
          <span class="lbl">{cell.use ? cell.use.label : (cell.assignable ? '' : '—')}</span>
        </div>
      {/each}
    </div>

    <div class="legend">
      {#each ROLE_ORDER as role (role)}
        <span class="legend-chip role-chip pinrole-{role}" class:dim={!rolesPresent.has(role)}>
          <span class="swatch"></span>{ROLE_LEGEND[role]}
        </span>
      {/each}
      <span class="legend-chip free-chip"><span class="swatch"></span>FREE</span>
      <span class="legend-chip reserved-chip"><span class="swatch"></span>RESERVED</span>
      <span class="legend-chip adc-chip"><span class="adc-mark">▪</span>ADC-CAPABLE</span>
    </div>
  {/if}
</Panel>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 3px;
    padding: 12px 14px 8px;
  }
  .cell {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    min-height: 30px;
    padding: 3px 2px;
    border-radius: var(--radius-s);
    border: 1px solid var(--border);
    background: var(--wash);
    color: var(--text-faint);
    overflow: hidden;
  }
  .cell.used {
    background: color-mix(in oklab, var(--role-base) 14%, transparent);
    border-color: color-mix(in oklab, var(--role-base) 45%, transparent);
    color: var(--role-base);
  }
  .cell.reserved {
    background: repeating-linear-gradient(45deg, transparent 0 3px, var(--wash-strong) 3px 4px);
  }
  .cell.reserved .num { opacity: var(--dim-disabled); }
  .num {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.3px;
  }
  .lbl {
    font-family: var(--font-mono);
    font-size: 8px;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }
  .adc-mark {
    position: absolute;
    top: 1px;
    right: 2px;
    font-size: 7px;
    line-height: 1;
    color: var(--text-faint);
  }
  .cell.used .adc-mark { color: var(--role-base); }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    padding: 8px 14px 14px;
    border-top: 1px solid var(--border);
  }
  .legend-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .legend-chip.dim { opacity: var(--dim-disabled); }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex: none;
  }
  .role-chip .swatch {
    background: var(--role-base);
    border: 1px solid color-mix(in oklab, var(--role-base) 60%, transparent);
  }
  .free-chip .swatch { background: var(--wash); border: 1px solid var(--border); }
  .reserved-chip .swatch {
    background: repeating-linear-gradient(45deg, transparent 0 2px, var(--wash-strong) 2px 3px);
    border: 1px solid var(--border);
  }
  .adc-chip .adc-mark { position: static; font-size: 9px; }
</style>

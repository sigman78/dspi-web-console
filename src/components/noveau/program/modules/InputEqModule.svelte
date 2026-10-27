<script lang="ts">
  import { FilterType, inputIndexOf } from '@/domain';
  import { selectChannel } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import BodePlot, { type BodeCurve } from '@/components/bode/BodePlot.svelte';
  import { filterCurve } from '@/components/bode/filterCurve';
  import { chShade } from '@/styles/palette';
  import { noveauUi } from '@/components/noveau/noveauUi.svelte';
  import { fmtSigned } from '../chainModel';
  import ModuleFrame from './ModuleFrame.svelte';

  const s = getSession();
  const inputs = $derived(
    (s.mirror.current?.channels ?? [])
      .filter((c) => !c.isOutput)
      .sort((a, b) => (inputIndexOf(a.id) ?? 0) - (inputIndexOf(b.id) ?? 0))
      .map((c) => {
        const slot = inputIndexOf(c.id);
        return {
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          bands: c.filters.filter((f) => f.type !== FilterType.Flat).length,
          preampDb: (slot === null ? 0 : s.mirror.current?.inputPreampDb[slot]) ?? 0,
          filters: c.filters,
          xover: c.xoverBands,
        };
      }),
  );

  const curves = $derived<BodeCurve[]>(
    inputs.map((i) => ({ id: `ieq-${i.id}`, channelId: i.id, label: i.shortName, points: filterCurve(i.filters, i.preampDb, i.xover) })),
  );
  function edit(id: (typeof inputs)[number]['id']): void {
    selectChannel(id);
    noveauUi.destination = 'tune';
  }
</script>

<ModuleFrame title="Input EQ" pass="inputs · PASS 2"
  blurb="Up to 10 parametric bands per input, applied before routing. Edit bands in TUNE with an input selected.">
  <BodePlot {curves} height={180} />
  {#each inputs as inp (inp.id)}
    <div class="r">
      <span class="dot" style:background={chShade(inp.id, 'bright')}></span>
      <span class="lbl" title={inp.name}>{inp.name}</span>
      <span class="note">{inp.bands} {inp.bands === 1 ? 'band' : 'bands'}</span>
      <span class="mono pre">{fmtSigned(inp.preampDb)} dB</span>
      <button type="button" class="jump" aria-label={`Open ${inp.name} in TUNE`} title={`Open ${inp.name} in TUNE`} onclick={() => edit(inp.id)}>»</button>
    </div>
  {/each}
</ModuleFrame>

<style>
  .dot { flex: 0 0 8px; height: 8px; border-radius: 50%; margin-left: 4px; }
  .pre { margin-left: auto; }
</style>

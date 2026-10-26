<script lang="ts">
  import { FilterType, inputIndexOf } from '@/domain';
  import { selectChannel } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { noveauUi } from '../../noveauUi.svelte';
  import ModuleFrame from './ModuleFrame.svelte';

  const s = getSession();
  const inputs = $derived(
    (s.mirror.current?.channels ?? [])
      .filter((c) => !c.isOutput)
      .sort((a, b) => (inputIndexOf(a.id) ?? 0) - (inputIndexOf(b.id) ?? 0))
      .map((c) => ({ id: c.id, name: c.name, used: c.filters.filter((f) => f.type !== FilterType.Flat).length })),
  );

  function edit(id: (typeof inputs)[number]['id']): void {
    selectChannel(id);
    noveauUi.destination = 'tune';
  }
</script>

<ModuleFrame title="Input EQ" pass="per input · before leveller">
  <div class="r head">
    <span class="lbl">INPUT</span>
    <span class="lbl">BANDS</span>
  </div>
  {#each inputs as inp (inp.id)}
    <div class="r">
      <span class="lbl" title={inp.name}>{inp.name}</span>
      <span class="lbl mono" class:dim={inp.used === 0}>{inp.used === 0 ? 'flat' : `${inp.used} in use`}</span>
      <button type="button" class="chip hi" aria-label={`Edit ${inp.name} EQ in TUNE`} onclick={() => edit(inp.id)}>Edit in TUNE</button>
    </div>
  {/each}
</ModuleFrame>

<style>
  .lbl.mono { color: var(--text); }
  .lbl.dim { color: var(--text-faint); }
</style>

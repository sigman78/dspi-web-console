<script lang="ts">
  import { Eq, inputIndexOf, type InputSlot } from '@/domain';
  import * as Runtime from '@/runtime';
  import { getSession } from '@/components/sessionContext';
  import ModuleFrame from './ModuleFrame.svelte';
  import SliderField from '@/components/chrome/SliderField.svelte';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const inputs = $derived(
    (snap?.channels ?? [])
      .filter((c) => !c.isOutput)
      .flatMap((c) => {
        const slot = inputIndexOf(c.id);
        return slot === null ? [] : [{ id: c.id, name: c.name, slot: slot as InputSlot }];
      })
      .sort((a, b) => a.slot - b.slot),
  );
</script>

<ModuleFrame title="Preamp" pass="inputs · PASS 1"
  blurb="Per-input gain ahead of everything else. Trim hot sources or balance channels before EQ sees them.">
  <SliderField lane="scrub"
    label="MASTER"
    ariaLabel="Master preamp"
    value={snap?.masterPreampDb ?? 0}
    min={Eq.PREAMP_MIN_DB} max={Eq.PREAMP_MAX_DB} step={Eq.PREAMP_STEP_DB}
    kind="dB-signed"
    precision={1}
    resetTo={0}
    onChange={(v) => Runtime.setMasterPreamp(s, v)}
  />
  {#each inputs as inp (inp.id)}
    <SliderField lane="scrub"
      label={inp.name}
      ariaLabel={`${inp.name} preamp`}
      value={snap?.inputPreampDb[inp.slot] ?? 0}
      min={Eq.PREAMP_MIN_DB} max={Eq.PREAMP_MAX_DB} step={Eq.PREAMP_STEP_DB}
      kind="dB-signed"
      precision={1}
      resetTo={0}
      onChange={(v) => Runtime.setInputPreamp(s, inp.slot, v)}
    />
  {/each}
</ModuleFrame>

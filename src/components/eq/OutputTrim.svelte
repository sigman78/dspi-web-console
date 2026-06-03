<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import ValueField from '../chrome/ValueField.svelte';
  import { setOutputGain, setOutputDelay } from '@/runtime';
  import { Mix, type OutputModel } from '@/domain';
  import { getSession } from '../sessionContext';

  const {
    output,
  }: {
    output: OutputModel;
  } = $props();

  const s = getSession();
</script>

<Panel code="EQ.04" title="OUTPUT TRIM">
  <div class="row">
    <div class="cell">
      <span class="lbl">GAIN</span>
      <ValueField
        kind="dB-signed"
        tone="signed"
        min={Mix.OUTPUT_GAIN_MIN_DB}
        max={Mix.OUTPUT_GAIN_MAX_DB}
        step={Mix.OUTPUT_GAIN_STEP_DB}
        align="right"
        value={output.gainDb}
        onChange={(v) => setOutputGain(s, output.wireIndex, v)}
      />
    </div>
    <div class="cell">
      <span class="lbl">DELAY</span>
      <ValueField
        kind="ms"
        min={Mix.OUTPUT_DELAY_MIN_MS}
        max={Mix.OUTPUT_DELAY_MAX_MS}
        step={Mix.OUTPUT_DELAY_STEP_MS}
        align="right"
        value={output.delayMs}
        onChange={(v) => setOutputDelay(s, output.wireIndex, v)}
      />
    </div>
  </div>
</Panel>

<style>
  .row {
    padding: 12px 14px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .cell {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .lbl {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1px;
    width: 44px;
  }
</style>

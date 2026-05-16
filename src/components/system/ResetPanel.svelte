<!-- src/components/system/ResetPanel.svelte -->
<script lang="ts">
  import Panel from '../chrome/Panel.svelte';
  import { presets } from '../../state/presets.svelte';
  import { session } from '../../state/session.svelte';
  import { fullSync } from '../../runtime/actions';
  import { PRESET_SLOT_COUNT } from '../../domain/presetLimits';

  const connected = $derived(session.status === 'connected');

  async function onFactoryReset() {
    if (!confirm('Factory reset wipes ALL presets and resets live audio to defaults. Continue?')) return;
    const d = session.device; if (!d) return;
    const r = await d.factoryReset();
    if (r.ok) {
      presets.directory = null;
      presets.names = Array.from({ length: PRESET_SLOT_COUNT }, () => null);
      await fullSync();
    } else {
      alert(`Factory reset failed: ${r.message ?? 'unknown error'}`);
    }
  }
</script>

<Panel code="SY.05" title="RESET">
  <div class="body">
    <button class="danger" onclick={onFactoryReset} disabled={!connected}>FACTORY RESET</button>
    <p class="hint">Wipes all presets and resets live audio to firmware defaults.</p>
  </div>
</Panel>

<style>
  .body { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .danger {
    padding: 6px 14px; border-radius: 4px;
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 1.5px; font-weight: 700;
    background: color-mix(in oklab, var(--err) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--err) 50%, var(--border));
    color: var(--err); cursor: pointer;
    align-self: flex-start;
  }
  .danger:disabled { opacity: 0.4; cursor: default; }
  .hint {
    font-family: var(--font-mono); font-size: 9px; letter-spacing: 1px;
    color: var(--text-faint); margin: 0;
  }
</style>

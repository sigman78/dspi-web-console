<script lang="ts">
  import { connection } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { setBypass } from '@/runtime';
  import DeviceSwitcher from '@/components/chrome/DeviceSwitcher.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import SceneRow from './SceneRow.svelte';
  import VolumeBlock from './VolumeBlock.svelte';

  const s = getSession();
  const bypassed = $derived(s.mirror.current?.bypass ?? false);
</script>

<div class="rhead">
  <DeviceSwitcher />
  <SceneRow />
  <VolumeBlock />
  <div class="brow">
    <span>BYPASS</span>
    <ToggleSwitch
      size="sm"
      checked={bypassed}
      disabled={!connection.connected}
      ariaLabel={bypassed ? 'Disable EQ bypass' : 'Enable EQ bypass'}
      onChange={(v) => setBypass(s, v)}
    />
  </div>
</div>

<style>
  .rhead {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .brow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-dim);
  }
</style>

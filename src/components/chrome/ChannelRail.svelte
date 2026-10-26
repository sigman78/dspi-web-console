<script lang="ts">
  import ChannelList from './ChannelList.svelte';
  import DeviceSwitcher from './DeviceSwitcher.svelte';
  import PresetActiveChip from '@/components/presets/PresetActiveChip.svelte';
</script>

<div class="rail">
  <div class="rail-head">
    <DeviceSwitcher />
    <div class="microlbl">PRESET</div>
    <PresetActiveChip />
  </div>
  <ChannelList />
</div>

<style>
  .rail {
    width: 196px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg) 40%, transparent);
  }
  .rail-head {
    padding: 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rail-head .microlbl { margin-top: 0; }
</style>

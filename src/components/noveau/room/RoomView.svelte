<script lang="ts">
  import RoomVisual from './RoomVisual.svelte';
  import PresetStrip from './PresetStrip.svelte';
</script>

<div class="room">
  <RoomVisual />
  <PresetStrip />
</div>

<style>
  .room { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
</style>

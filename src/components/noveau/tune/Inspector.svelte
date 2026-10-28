<script lang="ts">
  import type { ChannelModel, OutputModel } from '@/domain';
  import BandsTable from './BandsTable.svelte';
  import SourcesSection from './SourcesSection.svelte';

  const { channel, output }: { channel: ChannelModel; output: OutputModel | null } = $props();
</script>

<aside class="inspector" aria-label="Inspector">
  <BandsTable {channel} />
  <SourcesSection {channel} {output} />
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 0 8px;
    border-left: 1px solid var(--border);
  }
</style>

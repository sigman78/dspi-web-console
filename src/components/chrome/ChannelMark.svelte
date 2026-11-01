<script lang="ts">
  import { channelLayoutById, type ChannelId } from '@/domain';
  import { chShade } from '@/styles/palette';

  const { id, class: cls = '' }: { id: ChannelId; class?: string } = $props();
  const isOutput = $derived(channelLayoutById(id).isOutput);
</script>

<span
  class="mark {cls}"
  class:out={isOutput}
  style:background={chShade(id, 'bright')}
  aria-hidden="true"
></span>

<style>
  /* Inputs are an arrow head pointing in, outputs a notched tail. */
  .mark { display: inline-block; flex: none; width: 8px; height: 8px; clip-path: polygon(0 0, 60% 0, 100% 50%, 60% 100%, 0 100%); }
  .mark.out { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 40% 50%); }
</style>

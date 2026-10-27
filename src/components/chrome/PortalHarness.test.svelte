<script lang="ts">
  import { portal } from './portal';
  let { t, on }: { t: HTMLElement | null; on: boolean } = $props();
  export function set(nextT: HTMLElement | null, nextOn: boolean): void {
    t = nextT;
    on = nextOn;
  }
</script>

<div class="host">
  {#if on}<i></i><b use:portal={t}></b>{/if}
  <span class="after"></span>
</div>

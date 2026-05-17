<script lang="ts">
  import { isInFlight } from '@/state';
</script>

<span class="dirty-dot" class:active={isInFlight.current} aria-hidden="true"></span>

<style>
  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent, currentColor);
    opacity: 0;
    transition: opacity 120ms ease-out;
    display: inline-block;
    vertical-align: middle;
  }
  .dirty-dot.active {
    opacity: 1;
    box-shadow: 0 0 6px var(--accent, currentColor);
  }
</style>

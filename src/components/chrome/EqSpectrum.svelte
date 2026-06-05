<script lang="ts">
  // Decorative looped EQ spectrum. Pure CSS animation, honors
  // prefers-reduced-motion. Fixed pseudo-random heights/delays avoid a
  // runtime RNG.
  const HEIGHTS = [30, 55, 72, 90, 60, 48, 80, 40, 68, 84, 52, 74, 36, 60, 44, 68];
  const DELAYS  = [-0.05, -0.50, -0.20, -0.80, -0.30, -1.10, -0.10, -0.95,
                   -0.45, -0.65, -0.25, -0.85, -0.40, -1.20, -0.15, -0.75];
</script>

<div class="eq-spectrum" aria-hidden="true">
  {#each HEIGHTS as h, i (i)}
    <span
      class="bar"
      style="height: {h}%; animation-delay: {DELAYS[i]}s"
    ></span>
  {/each}
</div>

<style>
  .eq-spectrum {
    display: flex;
    align-items: end;
    gap: 4px;
    height: 70px;
  }
  .bar {
    width: 5px;
    background: var(--accent);
    box-shadow: 0 0 6px color-mix(in oklab, var(--accent) 40%, transparent);
    border-radius: 1px 1px 0 0;
    transform-origin: bottom;
    display: block;
    animation: eq-bar 1.4s ease-in-out infinite;
  }
  @keyframes eq-bar {
    0%, 100% { transform: scaleY(0.35); }
    50%      { transform: scaleY(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar { animation: none; }
  }
</style>

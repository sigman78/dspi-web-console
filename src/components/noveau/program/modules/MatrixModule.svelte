<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import { liveRouteCount } from '../chainModel';
  import { upmixStatus, upmixStatusText } from '../upmixStatus';
  import ModuleFrame from './ModuleFrame.svelte';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const features = $derived(s.device.capabilities.features);

  const liveOutputs = $derived(new Set((snap?.outputs ?? []).filter((o) => o.enabled).map((o) => o.wireIndex)));
  const live = $derived((snap?.routes ?? []).filter((r) => liveOutputs.has(r.outputWireIndex)));
  const routed = $derived(live.filter((r) => r.enabled));
  const routeCount = $derived(snap ? liveRouteCount(snap) : 0);
  const inverted = $derived(routed.filter((r) => r.invert).length);

  const status = $derived(
    upmixStatus(snap?.upmix.enabled ?? false, s.telemetry.activeInputChannels, s.telemetry.info?.sampleRateHz ?? null),
  );
</script>

<ModuleFrame
  title="Matrix"
  pass="routing · inputs → outputs"
  blurb="Routes every input to any output, with gain and phase per crosspoint. Click a dot on the routing map to route it; the popover sets gain and phase, UNROUTE removes it."
>
  <div class="r">
    <span class="lbl">ROUTES</span>
    <span class="ctl"><span class="mono">{routeCount}</span><span class="note">of {live.length} crosspoints on enabled outputs</span></span>
  </div>
  <div class="r">
    <span class="lbl">INVERTED</span>
    <span class="ctl"><span class="mono">{inverted}</span></span>
  </div>
  {#if features.upmix}
    <div class="r">
      <span class="lbl">UPMIX</span>
      <span class="ctl"><span class="mono" class:ok={status === 'active'}>{upmixStatusText(status)}</span></span>
    </div>
  {/if}
</ModuleFrame>

<style>
  .mono.ok { color: var(--ok); }
</style>

<script lang="ts">
  import { getSession } from '@/components/sessionContext';
  import { liveRouteCount } from '@/components/noveau/program/chainModel';
  import { upmixParkingStatus, upmixParkingText } from '@/domain';
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
    upmixParkingStatus(snap?.upmix.enabled ?? false, s.telemetry.activeInputChannels, s.telemetry.info?.sampleRateHz ?? null),
  );
</script>

<ModuleFrame
  title="Matrix"
  pass="routing · inputs → outputs"
  blurb="Routes every input to any output, with gain and phase per crosspoint. Click a dot on the routing map to route it; the popover sets gain and phase, UNROUTE removes it."
>
  <div class="prow">
    <span class="prow-lbl">ROUTES</span>
    <span class="prow-ctl"><span class="t-value">{routeCount}</span><span class="prow-note">of {live.length} crosspoints on enabled outputs</span></span>
  </div>
  <div class="prow">
    <span class="prow-lbl">INVERTED</span>
    <span class="prow-ctl"><span class="t-value">{inverted}</span></span>
  </div>
  {#if features.upmix}
    <div class="prow">
      <span class="prow-lbl">UPMIX</span>
      <span class="prow-ctl"><span class="t-value" class:ok={status === 'active'}>{upmixParkingText(status)}</span></span>
    </div>
  {/if}
</ModuleFrame>

<style>
  .t-value.ok { color: var(--ok); }
</style>

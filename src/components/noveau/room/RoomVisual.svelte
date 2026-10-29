<script lang="ts">
  import { onMount } from 'svelte';
  import * as Domain from '@/domain';
  import { formatRateKHz } from '@/utils';
  import { getSession } from '@/components/sessionContext';
  import * as Fx from '@/fx';

  const s = getSession();
  const SYNC_MS = 250;
  const MAX_OUTPUTS = 9;
  const SOURCE_LABELS: Record<number, string> = {
    [Domain.AudioInputSource.Usb]: 'USB',
    [Domain.AudioInputSource.Spdif]: 'S/PDIF',
    [Domain.AudioInputSource.Spdif2]: 'S/PDIF 2',
    [Domain.AudioInputSource.Spdif3]: 'S/PDIF 3',
    [Domain.AudioInputSource.Spdif4]: 'S/PDIF 4',
    [Domain.AudioInputSource.I2s]: 'I2S',
    [Domain.AudioInputSource.Adat]: 'ADAT',
  };

  const active = $derived(s.presets.active);
  const rawName = $derived(active == null ? '' : (s.presets.names[active] ?? ''));
  const named = $derived(rawName.length > 0);
  const presetName = $derived(active == null ? 'No preset' : named ? rawName : `Preset ${active}`);
  const source = $derived(SOURCE_LABELS[s.mirror.current?.inputConfig.source ?? Domain.AudioInputSource.Usb] ?? 'USB');
  const rateHz = $derived(s.telemetry.info?.sampleRateHz);
  const rate = $derived(rateHz != null ? formatRateKHz(rateHz) : '—');

  let host: HTMLDivElement;
  let back: HTMLCanvasElement;
  let front: HTMLCanvasElement;

  // Replies older than this fall back to the simulated spectrum.
  const RTA_FRESH_MS = 1000;
  const SETTLE_MS = 1500;
  const tele = s.telemetry;

  let outputLevel = 0;
  const simulated = Fx.simulatedSpectrum(() => outputLevel);

  const live = Fx.rtaSpectrum({
    centresHz: () => tele.rtaCentres,
    frames: () => tele.rtaFrames,
  });

  // Written from the frame loop only when it flips, so the tag follows the
  // feed in use without per-frame reactivity.
  let usingRta = $state(false);
  // Keeps the tag off while the first reply is pending on RTA-capable firmware.
  let settling = $state(s.device.capabilities?.features.rta === true);

  onMount(() => {
    const releaseRta = tele.wantRta();
    const settleTimer = setTimeout(() => { settling = false; }, SETTLE_MS);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scene = new Fx.RoomScene({ back, front }, {
      palette: Fx.resolvePalette(host),
      decorative: () => !reduced.matches,
    });
    const outIds = new Int32Array(MAX_OUTPUTS);
    let outCount = 0;

    function syncChannels(): void {
      const snap = s.mirror.current;
      outCount = 0;
      if (!snap) return;
      for (const ch of snap.channels) {
        if (!ch.isOutput || outCount >= MAX_OUTPUTS) continue;
        if (!snap.outputs.some((o) => o.id === ch.id && o.enabled)) continue;
        outIds[outCount++] = ch.id;
      }
    }

    function readLevel(): void {
      const peaks = s.telemetry.peaks;
      let loudest = 0;
      for (let k = 0; k < outCount; k++) loudest = Math.max(loudest, peaks[outIds[k]] ?? 0);
      outputLevel = loudest;
    }

    function fit(): void {
      const r = host.getBoundingClientRect();
      scene.resize(r.width, r.height, window.devicePixelRatio || 1);
    }

    syncChannels();
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);

    let lastSync = 0;
    const loop = Fx.createFxLoop({
      reducedMotion: () => reduced.matches,
      frame(now, dt) {
        if (now - lastSync > SYNC_MS) { lastSync = now; syncChannels(); }
        readLevel();
        const rta = tele.rtaAvailability === 'available' && tele.lastRtaReplyMs > 0 && now - tele.lastRtaReplyMs < RTA_FRESH_MS;
        if (rta !== usingRta) usingRta = rta;
        scene.draw(now, dt, (rta ? live : simulated).bands(now));
      },
    });
    loop.start();

    return () => {
      releaseRta();
      clearTimeout(settleTimer);
      loop.dispose();
      ro.disconnect();
    };
  });
</script>

<div class="visual" bind:this={host}>
  <canvas bind:this={back} aria-hidden="true"></canvas>
  <canvas bind:this={front} aria-hidden="true"></canvas>
  <div class="caption">
    <div class="preset" class:unnamed={!named}>{presetName}</div>
    <div class="meta">{source} · {rate}</div>
  </div>
  {#if !usingRta && (!settling || tele.rtaAvailability === 'unavailable')}
    <div class="tag">SIMULATED SPECTRUM</div>
  {/if}
</div>

<style>
  .visual {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: linear-gradient(to bottom, transparent 55%, color-mix(in oklab, var(--accent) 4%, transparent));
  }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .caption { position: absolute; left: 76px; top: 18px; pointer-events: none; }
  .preset {
    font-size: 26px;
    font-weight: 600;
    line-height: 1.15;
    color: var(--text);
    max-width: 520px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preset.unnamed { color: var(--text-faint); font-weight: 500; }
  .meta { margin-top: 4px; font-family: var(--font-mono); font-size: var(--fs-m); color: var(--text-faint); }
  .tag {
    position: absolute;
    right: 76px;
    top: 22px;
    font-family: var(--font-mono);
    font-size: var(--fs-m);
    letter-spacing: 0.08em;
    color: var(--text-faint);
    opacity: 0.7;
    pointer-events: none;
  }
</style>

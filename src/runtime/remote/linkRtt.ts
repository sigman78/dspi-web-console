// Smooths round-trip samples and passes them on at most once per interval,
// so a 20 Hz poll does not become a 20 Hz repaint.

const SMOOTHING = 0.2;
export const PUBLISH_INTERVAL_MS = 1000;

export function createRttMeter(
  publish: (ms: number) => void,
  now: () => number = () => performance.now(),
): (sampleMs: number) => void {
  let average: number | null = null;
  let lastPublish = -Infinity;
  return (sampleMs) => {
    average = average === null ? sampleMs : average + SMOOTHING * (sampleMs - average);
    const t = now();
    if (t - lastPublish < PUBLISH_INTERVAL_MS) return;
    lastPublish = t;
    publish(average);
  };
}

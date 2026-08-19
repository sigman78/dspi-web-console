export function formatRateKHz(hz: number): string {
  return hz > 0 ? `${(hz / 1000).toFixed(1)} kHz` : '—';
}

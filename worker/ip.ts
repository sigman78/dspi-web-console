/**
 * Rate-limit bucket for a client address. IPv4 is used as is; IPv6 collapses to
 * its /64 prefix because one subscriber typically controls the whole /64.
 */
export function limiterKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) return tail; // IPv4-mapped address

  const halves = ip.split('::');
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const rest = halves.length > 1 && halves[1] !== '' ? halves[1].split(':') : [];
  const zeros = Array<string>(Math.max(0, 8 - head.length - rest.length)).fill('0');
  const groups = halves.length > 1 ? [...head, ...zeros, ...rest] : head;
  return `v6:${groups
    .slice(0, 4)
    .map((g) => parseInt(g || '0', 16).toString(16))
    .join(':')}`;
}

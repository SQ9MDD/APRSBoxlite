// TNC2 convention marks the last used hop; preceding hops were also used.
export function routeCallsigns(packet: string): string[] | undefined {
  const match = packet.match(/^\s*([A-Z0-9]{1,6}(?:-\d{1,2})?)>[^,:]+((?:,[^:]*)?):(.*)$/i);
  if (!match || match[3].startsWith('}')) return undefined;
  const normalize = (value: string) => value.toUpperCase().replace(/-0$/, '');
  const hops = match[2] ? match[2].slice(1).split(',') : [];
  const lastUsed = hops.findLastIndex((hop) => hop.endsWith('*'));
  const used = hops.slice(0, lastUsed + 1).map((hop) => normalize(hop.replace(/\*$/, '')));
  const isAlias = (hop: string) => /^(?:WIDE[1-7]|TRACE[1-7]|RELAY)(?:-\d{1,2})?$/.test(hop);
  // When a real digipeater is named, WIDE/TRACE/RELAY are routing aliases,
  // not additional map positions. Keep aliases if no real hop is available.
  const actualHops = used.some((hop) => !isAlias(hop)) ? used.filter((hop) => !isAlias(hop)) : used;
  return [normalize(match[1]), ...actualHops];
}

export function routeSegments<T>(points: Array<T | undefined>): Array<{ from: T; to: T; approximate: boolean }> {
  const segments: Array<{ from: T; to: T; approximate: boolean }> = [];
  let previous: { point: T; index: number } | undefined;
  points.forEach((point, index) => {
    if (point === undefined) return;
    if (previous) segments.push({ from: previous.point, to: point, approximate: index - previous.index > 1 });
    previous = { point, index };
  });
  return segments;
}

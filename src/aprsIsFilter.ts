export function defaultAprsIsFilter(location: unknown, radius: unknown = '25'): string | undefined {
  const match = typeof location === 'string' ? location.trim().match(/^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/) : null;
  if (!match) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  const distance = Number(radius);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(distance) || distance <= 0 || distance > 10000) return undefined;
  return `r/${latitude}/${longitude}/${distance}`;
}

export function validAprsIsFilter(filter: string): boolean {
  return filter.length <= 400 && /^[\x20-\x7e]*$/.test(filter);
}

export interface MessageGroups { rf: string[]; aprsIs: string[] }
export const DEFAULT_MESSAGE_GROUPS = ['ALL', 'QST', 'CQ'];

export function normalizeMessageGroups(value: unknown): string[] {
  if (typeof value !== 'string' && !Array.isArray(value)) throw new Error('Invalid message groups.');
  const values: unknown[] = typeof value === 'string' ? (value.trim() ? value.replace(/\n/g, ',').split(',') : []) : value;
  const result: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') throw new Error('Invalid message group.');
    const group = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,9}$/.test(group) || group.startsWith('BLN')) throw new Error('Groups must be 1–9 letters or digits, separated by commas; BLN is reserved.');
    if (!result.includes(group)) result.push(group);
  }
  if (result.length > 100) throw new Error('Too many message groups.');
  return result;
}

export function readMessageGroups(value: unknown): MessageGroups {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rf = record.rf === undefined ? [...DEFAULT_MESSAGE_GROUPS] : normalizeMessageGroups(record.rf);
  const aprsIs = record.aprsIs === undefined ? [...rf] : normalizeMessageGroups(record.aprsIs);
  return { rf, aprsIs };
}

export function appendAprsIsGroups(filter: string, groups: string[]): string {
  const existing = new Set(filter.trim().split(/\s+/).filter((token) => /^g\//i.test(token)).flatMap((token) => token.slice(2).split('/').map((group) => group.toUpperCase())));
  const missing = groups.filter((group) => !existing.has(group.toUpperCase()));
  return [filter.trim(), missing.length ? `g/${missing.join('/')}` : ''].filter(Boolean).join(' ');
}

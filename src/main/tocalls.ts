import database from '../data/tocalls.json' with { type: 'json' };

interface TocallEntry {
  model?: string;
  vendor?: string;
}

const entries = database.tocalls as Record<string, TocallEntry>;
const wildcardPatterns = Object.keys(entries)
  .filter((pattern) => pattern.includes('?'))
  .sort(
    (a, b) =>
      (a.match(/\?/g)?.length ?? 0) - (b.match(/\?/g)?.length ?? 0) ||
      a.localeCompare(b, 'en'),
  );

export function lookupTocall(destination: string): string | undefined {
  const value = destination.trim().toUpperCase().split('-')[0];
  const entry =
    entries[value] ??
    entries[
      wildcardPatterns.find(
        (pattern) =>
          pattern.length === value.length &&
          [...pattern].every(
            (character, index) =>
              character === '?' || character === value[index],
          ),
      ) ?? ''
    ];
  if (!entry) return undefined;
  return entry.model?.trim() || entry.vendor?.trim() || undefined;
}

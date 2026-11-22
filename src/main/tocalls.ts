import database from '../data/tocalls.json' with { type: 'json' };
import type { AprsDevice } from '../types';

interface DeviceEntry {
  model?: string;
  vendor?: string;
  os?: string;
  class?: string;
  features?: string[];
}

let entries = database.tocalls as Record<string, DeviceEntry>;
let mice = database.mice as Record<string, DeviceEntry>;
let legacy = database.micelegacy as Record<string, DeviceEntry>;
let classes = database.classes as Record<string, { shown?: string; description?: string }>;
const classFallbacks: Record<string, [string, string]> = {
  app: ['Mobile app', 'Mobile phone or tablet APRS app'],
  daemon: ['Background software', 'Computer software without a user interface'],
  digi: ['Digipeater', 'Digipeater software'],
  dstar: ['D-Star APRS client', 'D-Star APRS client'],
  gadget: ['APRS device', 'Small APRS device'],
  ht: ['Handheld APRS client', 'Handheld APRS client'],
  igate: ['iGate', 'iGate software'],
  network: ['APRS network appliance', 'Hardware appliance with built-in APRS networking features'],
  rig: ['Mobile/desktop APRS client', 'Mobile or desktop APRS client'],
  satellite: ['Satellite', 'Satellite-based APRS station'],
  service: ['Service', 'Service, bot, or hosted APRS software'],
  software: ['Desktop software', 'Desktop APRS software'],
  tracker: ['Tracker', 'Tracker device'],
  wx: ['Weather station', 'Dedicated APRS weather station'],
};
function getWildcardPatterns(values: Record<string, DeviceEntry>): string[] {
  return Object.keys(values)
  .filter((pattern) => pattern.includes('?'))
  .sort((a, b) => (a.match(/\?/g)?.length ?? 0) - (b.match(/\?/g)?.length ?? 0) || a.localeCompare(b, 'en'));
}
let wildcardPatterns = getWildcardPatterns(entries);

export function replaceTocallDatabase(payload: unknown, activate = true): { count: number; generationTime?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid TOCALL database.');
  const root = payload as Record<string, unknown>;
  const readSection = (value: unknown, required = false): Record<string, DeviceEntry> => {
    if (value === undefined && !required) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid TOCALL database section.');
    const result: Record<string, DeviceEntry> = Object.create(null);
    for (const [key, raw] of Object.entries(value)) {
      if (!key || key.length > 64 || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid TOCALL database entry.');
      const entry = raw as Record<string, unknown>;
      for (const field of ['model', 'vendor', 'os', 'class']) if (entry[field] !== undefined && typeof entry[field] !== 'string') throw new Error('Invalid TOCALL database metadata.');
      if (entry.features !== undefined && (!Array.isArray(entry.features) || !entry.features.every((item: unknown) => typeof item === 'string'))) throw new Error('Invalid TOCALL database features.');
      result[key] = entry as DeviceEntry;
    }
    return result;
  };
  const tocalls = readSection(root.tocalls, true);
  if (!Object.keys(tocalls).length) throw new Error('TOCALL database is empty.');
  const nextEntries: Record<string, DeviceEntry> = Object.create(null);
  for (const [key, value] of Object.entries(tocalls)) nextEntries[key.toUpperCase()] = value;
  const nextMice = readSection(root.mice);
  const nextLegacy = readSection(root.micelegacy);
  const nextClasses = readSection(root.classes) as Record<string, { shown?: string; description?: string }>;
  for (const value of Object.values(nextClasses)) if ((value.shown !== undefined && typeof value.shown !== 'string') || (value.description !== undefined && typeof value.description !== 'string')) throw new Error('Invalid TOCALL class metadata.');
  if (activate) {
    entries = nextEntries; mice = nextMice; legacy = nextLegacy; classes = nextClasses;
    wildcardPatterns = getWildcardPatterns(entries);
  }
  const meta = root.meta as Record<string, unknown> | undefined;
  return { count: Object.keys(nextEntries).length, generationTime: typeof meta?.generation_time === 'string' ? meta.generation_time : undefined };
}

export function identifyAprsDevice(destination: string, info = ''): AprsDevice | undefined {
  const value = destination.trim().toUpperCase().replace(/-\d+$/, '');
  let pattern = entries[value] ? value : wildcardPatterns.find((candidate) =>
    candidate.length === value.length && [...candidate].every((character, index) => character === '?' || character === value[index]));
  let entry = pattern ? entries[pattern] : undefined;
  let identifier = value;
  let kind: AprsDevice['identifierKind'] = 'tocall';
  if (!entry && (info.startsWith('`') || info.startsWith("'")) && info.length >= 10) {
    const text = info.slice(9).trimEnd();
    const prefix = text[0];
    const suffix = text.length > 1 ? text.at(-1) : '';
    const exact = `${prefix ?? ''}${suffix ?? ''}`;
    pattern = (prefix === '>' || prefix === ']') ? (legacy[exact] ? exact : legacy[prefix] ? prefix : undefined) : undefined;
    if (pattern) entry = legacy[pattern];
    else if (text.length >= 2) {
      pattern = text.slice(-2);
      entry = mice[pattern];
    }
    if (entry && pattern) { identifier = pattern; kind = 'mic-e'; }
  }
  if (!entry || !pattern) return undefined;
  const model = entry.model?.trim() || undefined;
  const vendor = entry.vendor?.trim() || undefined;
  const code = entry.class?.trim().toLowerCase() || '';
  const metadata = classes[code];
  return {
    identifierKind: kind,
    actualIdentifier: identifier,
    matchedPattern: pattern,
    identifiedAs: model || vendor || pattern,
    model,
    vendor,
    classLabel: classFallbacks[code]?.[0] || metadata?.shown,
    classDescription: classFallbacks[code]?.[1] || metadata?.description,
    os: entry.os?.trim() || undefined,
    features: Array.isArray(entry.features) ? entry.features.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [],
  };
}

export function lookupTocall(destination: string): string | undefined {
  return identifyAprsDevice(destination)?.identifiedAs;
}

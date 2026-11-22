import database from '../data/tocalls.json' with { type: 'json' };
import type { AprsDevice } from '../types';

interface DeviceEntry {
  model?: string;
  vendor?: string;
  os?: string;
  class?: string;
  features?: string[];
}

const entries = database.tocalls as Record<string, DeviceEntry>;
const mice = database.mice as Record<string, DeviceEntry>;
const legacy = database.micelegacy as Record<string, DeviceEntry>;
const classes = database.classes as Record<string, { shown?: string; description?: string }>;
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
const wildcardPatterns = Object.keys(entries)
  .filter((pattern) => pattern.includes('?'))
  .sort((a, b) => (a.match(/\?/g)?.length ?? 0) - (b.match(/\?/g)?.length ?? 0) || a.localeCompare(b, 'en'));

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

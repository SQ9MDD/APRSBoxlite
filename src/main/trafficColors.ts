import { decodeAprsPosition } from './aprsPosition';

export type TrafficCategory = 'own-beacon' | 'own-weather' | 'own-message';

// APRSBox colors traffic from the configured station; other received frames stay neutral.
export function classifyTraffic(packet: string, ownCallsign: string): TrafficCategory | undefined {
  const match = packet.match(/^\s*([^>]+)>[^:]*:(.*)$/s);
  if (!match) return undefined;
  const normalize = (value: string) => value.trim().toUpperCase().replace(/-0$/, '');
  const source = normalize(match[1]);
  const own = normalize(ownCallsign);
  if (!own || !source) return undefined;
  const info = match[2];
  const weather = info.startsWith('_') || decodeAprsPosition(packet)?.symbol.endsWith('_');
  if (weather && source.split('-')[0] === own.split('-')[0]) return 'own-weather';
  if (source !== own) return undefined;
  if (info.startsWith(':') || info.startsWith('?') || info.startsWith('T#')) return 'own-message';
  return 'own-beacon';
}

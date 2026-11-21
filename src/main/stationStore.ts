import { decodeAprsPosition } from './aprsPosition';
import { lookupTocall } from './tocalls';
import { decodeAprsExtensions } from './aprsExtensions';
import type { Station } from '../types';

export const STATION_AGE_MS = 60 * 60 * 1_000;
const MAX_STATIONS = 1_000;
const MAX_TRACK_POINTS = 60;

export class StationStore {
  private readonly stations = new Map<string, Station>();
  private readonly onChange: (stations: Station[]) => void;
  private expiration: ReturnType<typeof setTimeout> | undefined;

  constructor(onChange: (stations: Station[]) => void) {
    this.onChange = onChange;
  }

  receive(packet: string, sourceInterface?: string): void {
    const position = decodeAprsPosition(packet);
    const headerMatch = packet.match(
      /^\s*([A-Z0-9]{1,6}(?:-\d{1,2})?)>\s*([^,:\s]+)(?:,([^:]*))?:/i,
    );
    if (!headerMatch) return;
    const callsign = headerMatch[1].toUpperCase().replace(/-0$/, '');
    const destination = headerMatch[2].toUpperCase();
    const path = headerMatch[3] ?? '';
    const previous = this.stations.get(callsign);
    if (!position) {
      if (
        !previous ||
        Date.now() -
          Date.parse(previous.positionReceivedAt ?? previous.lastHeard) >=
          STATION_AGE_MS
      )
        return;
      this.stations.set(callsign, {
        ...previous,
        destination,
        path,
        sourceInterface,
        lastHeard: new Date().toISOString(),
      });
      this.publish();
      return;
    }

    // AX.25 represents SSID zero as a bare callsign in the RX pipeline.
    const now = Date.now();
    const track = (previous?.track ?? []).filter(
      (point) => point.receivedAt > now - STATION_AGE_MS,
    );
    const last = track[track.length - 1];
    if (
      !last ||
      last.latitude !== position.latitude ||
      last.longitude !== position.longitude
    ) {
      track.push({
        latitude: position.latitude,
        longitude: position.longitude,
        receivedAt: now,
      });
    } else last.receivedAt = now;
    const phg = decodePhg(position.comment);
    this.stations.delete(callsign);
    this.stations.set(callsign, {
      ...position,
      callsign,
      aprsClient: lookupTocall(destination) ?? previous?.aprsClient,
      destination,
      path,
      sourceInterface,
      name: 'APRS station',
      kind:
        packet.split(':', 2)[1]?.startsWith("'") ||
        packet.split(':', 2)[1]?.startsWith('`') ||
        track.length > 1
          ? 'mobile'
          : position.symbol[1] === '_'
            ? 'weather'
            : 'station',
      lastHeard: new Date(now).toISOString(),
      positionReceivedAt: new Date(now).toISOString(),
      decoded: decodeAprsExtensions(packet, position.comment, position.symbol),
      track: track.slice(-MAX_TRACK_POINTS),
      phg,
    });
    if (this.stations.size > MAX_STATIONS) {
      const oldest = this.stations.keys().next().value;
      if (oldest !== undefined) this.stations.delete(oldest);
    }
    this.publish();
  }

  snapshot(): Station[] {
    const cutoff = Date.now() - STATION_AGE_MS;
    return [...this.stations.values()]
      .filter(
        (station) =>
          Date.parse(station.positionReceivedAt ?? station.lastHeard) > cutoff,
      )
      .reverse();
  }

  dispose(): void {
    clearTimeout(this.expiration);
    this.stations.clear();
  }

  private publish(): void {
    clearTimeout(this.expiration);
    const now = Date.now();
    let nextExpiration = Infinity;
    for (const [callsign, station] of this.stations) {
      station.track = station.track.filter(
        (point) => point.receivedAt > now - STATION_AGE_MS,
      );
      if (station.track.length)
        nextExpiration = Math.min(
          nextExpiration,
          station.track[0].receivedAt + STATION_AGE_MS,
        );
      const expiresAt =
        Date.parse(station.positionReceivedAt ?? station.lastHeard) +
        STATION_AGE_MS;
      if (expiresAt <= now) this.stations.delete(callsign);
      else nextExpiration = Math.min(nextExpiration, expiresAt);
    }
    if (Number.isFinite(nextExpiration)) {
      this.expiration = setTimeout(() => this.publish(), nextExpiration - now);
      this.expiration.unref();
    }
    this.onChange(this.snapshot());
  }
}

export function decodePhg(comment: string): Station['phg'] {
  const match = comment.match(/PHG([0-9])([0-9])([0-9])([0-8])(?!\d)/i);
  if (!match) return undefined;
  const power = Number(match[1]) ** 2;
  if (!power) return undefined;
  const height = 10 * 2 ** Number(match[2]);
  const gain = 10 ** (Number(match[3]) / 10);
  const rangeKm =
    Math.sqrt(2 * height * Math.sqrt((power / 10) * (gain / 2))) * 1.609344;
  return { rangeKm, direction: Number(match[4]) };
}

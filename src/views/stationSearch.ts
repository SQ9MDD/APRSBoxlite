import type { Station } from '../types';

export type StationFilter = 'all' | 'direct' | 'mobile' | 'fixed' | 'weather';

export function matchesStationFilter(station: Station, filter: StationFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'direct') return station.path !== undefined && !station.path.includes('*');
  if (filter === 'fixed') return station.kind !== 'mobile' && station.kind !== 'weather';
  return station.kind === filter;
}

export function filterStations(stations: Station[], filter: StationFilter, search: string): Station[] {
  const query = search.trim().toLowerCase();
  return stations.filter((station) => matchesStationFilter(station, filter) && (!query || [
    station.callsign, station.name, station.kind, station.comment,
    station.aprsClient, station.destination, station.path, station.sourceInterface,
    station.latitude.toFixed(5), station.longitude.toFixed(5), station.symbol,
  ].filter(Boolean).join(' ').toLowerCase().includes(query)));
}

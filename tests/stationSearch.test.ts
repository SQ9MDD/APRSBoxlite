import assert from 'node:assert/strict';
import test from 'node:test';
import { filterStations } from '../src/views/stationSearch.ts';
import type { Station } from '../src/types.ts';

const base: Station = { callsign: 'SQ9MDD-15', name: 'APRS station', kind: 'mobile', latitude: 50.0619, longitude: 19.9383, lastHeard: '2026-11-22T12:00:00Z', comment: 'Krakow beacon', symbol: '/>', path: 'WIDE1-1*', sourceInterface: 'VHF', track: [] };
const stations: Station[] = [base, { ...base, callsign: 'SP8ABC', kind: 'weather', comment: 'Rain', path: '', sourceInterface: 'UHF', directHeardAt: Date.parse(base.lastHeard) }];

test('filters stations using case-insensitive text and the selected category', () => {
  assert.deepEqual(filterStations(stations, 'all', '  sq9mdd  ').map((station) => station.callsign), ['SQ9MDD-15']);
  assert.deepEqual(filterStations(stations, 'all', 'rain').map((station) => station.callsign), ['SP8ABC']);
  assert.deepEqual(filterStations(stations, 'direct', 'uhf').map((station) => station.callsign), ['SP8ABC']);
  assert.equal(filterStations(stations, 'mobile', 'uhf').length, 0);
  assert.equal(filterStations(stations, 'all', '.*').length, 0);
  assert.equal(filterStations(stations, 'all', '  ').length, 2);
});

test('keeps objects and items separate from fixed and directly heard stations', () => {
  const entries: Station[] = [
    { ...base, callsign: 'SP8FIX', kind: 'station', directHeardAt: Date.parse(base.lastHeard) },
    { ...base, callsign: 'LOCALOBJ', kind: 'object', entityType: 'object' },
    { ...base, callsign: 'LOCALITEM', kind: 'object', entityType: 'item' },
    { ...base, callsign: 'ONLINE', kind: 'station', path: '' },
  ];
  assert.deepEqual(filterStations(entries, 'object', '').map((station) => station.callsign), ['LOCALOBJ', 'LOCALITEM']);
  assert.deepEqual(filterStations(entries, 'fixed', '').map((station) => station.callsign), ['SP8FIX', 'ONLINE']);
  assert.deepEqual(filterStations(entries, 'direct', '').map((station) => station.callsign), ['SP8FIX']);
  assert.deepEqual(filterStations(entries, 'object', 'item').map((station) => station.callsign), ['LOCALITEM']);
});

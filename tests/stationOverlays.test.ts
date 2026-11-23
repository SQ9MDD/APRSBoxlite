import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test, { mock } from 'node:test';
import bundledTocalls from '../src/data/tocalls.json' with { type: 'json' };
import type { TrafficFrame } from '../src/main/kissTcpRx.ts';

registerHooks({
  resolve(specifier, context, next) {
    const resolved =
      specifier === './aprsPosition' ||
      specifier === './tocalls' ||
      specifier === './aprsExtensions'
        ? `${specifier}.ts`
        : specifier;
    return next(resolved, context);
  },
});

const { StationStore, STATION_AGE_MS, decodePhg } =
  await import('../src/main/stationStore.ts');
const { replaceTocallDatabase } = await import('../src/main/tocalls.ts');

test('marks only locally received RF station packets as directly heard', () => {
  const position = '!5218.37N/02104.87E>Test';
  const cases: Array<[string, Pick<TrafficFrame, 'source' | 'direction'> | undefined, boolean]> = [
    [`SP8ABC>APRS:${position}`, { source: 'kiss', direction: 'rx' }, true],
    [`SP8ABC>APRS,WIDE1-1,WIDE2-1:${position}`, { source: 'kiss', direction: 'rx' }, true],
    [`SP8ABC>APRS,SR8DIG*,WIDE2-1:${position}`, { source: 'kiss', direction: 'rx' }, false],
    [`SP8ABC>APRS:${position}`, { source: 'aprs-is', direction: 'rx' }, false],
    [`SP8ABC>APRS:${position}`, { source: 'kiss', direction: 'tx' }, false],
    [`SP8ABC>APRS:${position}`, undefined, false],
    [`SR8GAT>APRS:}SP8ABC>APRS:${position}`, { source: 'kiss', direction: 'rx' }, false],
    ['SP8ABC>APRS:;LOCALOBJ *010203z5218.37N/02104.87E>Object', { source: 'kiss', direction: 'rx' }, false],
    ['SP8ABC>APRS:)LOCALITEM!5218.37N/02104.87E>Item', { source: 'kiss', direction: 'rx' }, false],
  ];
  for (const [packet, reception, expected] of cases) {
    const store = new StationStore(() => undefined);
    try {
      store.receive(packet, 'Test interface', reception);
      const [station] = store.snapshot();
      assert.ok(station, packet);
      assert.equal(station.directHeardAt !== undefined, expected, packet);
    } finally { store.dispose(); }
  }
});

test('keeps direct reception for one hour despite later relayed or internet packets', () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const store = new StationStore(() => undefined);
  const rf = { source: 'kiss', direction: 'rx' } as const;
  try {
    store.receive('SP8ABC>APRS:!5218.37N/02104.87E>Direct', 'VHF', rf);
    mock.timers.tick(1000);
    store.receive('SP8ABC>APRS,SR8DIG*:!5218.37N/02104.87E>Relayed', 'VHF', rf);
    mock.timers.tick(1000);
    store.receive('SP8ABC>APRS:>Internet status', 'Internet', { source: 'aprs-is', direction: 'rx' });
    assert.equal(store.snapshot()[0].directHeardAt, 1000);
    mock.timers.tick(STATION_AGE_MS - 2000);
    assert.equal(store.snapshot().length, 1);
    assert.equal(store.snapshot()[0].directHeardAt, undefined);
    store.receive('SP8ABC>APRS:>Direct status', 'VHF', rf);
    assert.equal(store.snapshot()[0].directHeardAt, Date.now());
    mock.timers.tick(1000);
    assert.equal(store.snapshot().length, 0);
  } finally { store.dispose(); mock.timers.reset(); }
});

test('decodes APRSBox PHG range and rejects invalid PHG', () => {
  const phg = decodePhg('PHG5130 Digipeater');
  assert.ok(phg);
  // Reference formula uses 25 W, 20 ft and 3 dBi, converted from miles.
  assert.ok(Math.abs(phg.rangeKm - 12.79) < 0.01);
  assert.equal(phg.direction, 0);
  assert.equal(decodePhg('PHG0130'), undefined);
  assert.equal(decodePhg('PHG5139'), undefined);
  assert.equal(decodePhg('PHG51301'), undefined);
});

test('refreshes identification of existing stations without changing their positions', () => {
  const store = new StationStore(() => undefined);
  try {
    store.receive('SP8ABC-9>APDW16:!5218.37N/02104.87E>Test');
    const original = store.snapshot()[0];
    replaceTocallDatabase({ tocalls: { 'APDW??': { model: 'New version' } } });
    store.refreshDeviceIdentification();
    const updated = store.snapshot()[0];
    assert.equal(updated.aprsClient, 'New version');
    assert.equal(updated.latitude, original.latitude);
    assert.equal(updated.positionReceivedAt, original.positionReceivedAt);
  } finally { store.dispose(); replaceTocallDatabase(bundledTocalls); }
});

test('retains moving station points for at most one hour', () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  try {
    let snapshot: ReturnType<InstanceType<typeof StationStore>['snapshot']> =
      [];
    const store = new StationStore((stations) => {
      snapshot = stations;
    });
    store.receive('SP8ABC-9>APRS:!5218.37N/02104.87E>PHG5130');
    mock.timers.tick(1000);
    store.receive('SP8ABC-9>APRS:!5219.37N/02104.87E>PHG5130');
    assert.equal(snapshot[0].kind, 'mobile');
    assert.equal(snapshot[0].track.length, 2);
    assert.ok(snapshot[0].phg);
    mock.timers.tick(STATION_AGE_MS - 1000);
    assert.equal(snapshot[0].track.length, 1);
    mock.timers.tick(1000);
    assert.equal(snapshot.length, 0);
    store.dispose();
  } finally {
    mock.timers.reset();
  }
});

test('refreshes reception details without extending the lifetime of a position', () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  try {
    let snapshot: ReturnType<InstanceType<typeof StationStore>['snapshot']> =
      [];
    const store = new StationStore((stations) => {
      snapshot = stations;
    });
    store.receive(
      'SP8ABC-9>APDW16,WIDE1-1*:!5218.37N/02104.87E>243/002',
      'TNC 1',
    );
    const original = snapshot[0];
    assert.equal(original.aprsClient, 'DireWolf');
    assert.equal(original.aprsDevice?.vendor, 'WB2OSZ');
    assert.equal(original.decoded?.courseDegrees, 243);
    mock.timers.tick(STATION_AGE_MS - 1000);
    store.receive('SP8ABC-9>APDW16,SR9ABC*:>Status', 'TNC 2');
    assert.equal(snapshot[0].sourceInterface, 'TNC 2');
    assert.equal(snapshot[0].path, 'SR9ABC*');
    assert.equal(snapshot[0].latitude, original.latitude);
    assert.equal(snapshot[0].positionReceivedAt, original.positionReceivedAt);
    assert.equal(snapshot[0].aprsDevice?.actualIdentifier, 'APDW16');
    mock.timers.tick(1000);
    assert.equal(snapshot.length, 0);
    store.dispose();
  } finally {
    mock.timers.reset();
  }
});

test('tracks objects separately from their sender and removes killed objects', () => {
  const store = new StationStore(() => undefined);
  try {
    store.receive('SP8ABC-9>APRS:!5218.37N/02104.87E>Station');
    store.receive('SP8ABC-9>APRS:;OBJTEST  *010203z5228.23N/02101.28E#Object', 'VHF');
    let stations = store.snapshot();
    assert.equal(stations.length, 2);
    assert.equal(stations.find((station) => station.callsign === 'OBJTEST')?.owner, 'SP8ABC-9');
    assert.equal(stations.find((station) => station.callsign === 'OBJTEST')?.kind, 'object');
    store.receive('SP8ABC-9>APRS:;OBJTEST  _010203z5268.23N/02101.28E#Invalid');
    assert.equal(store.snapshot().length, 2);
    store.receive('SP8ABC-9>APRS:;OBJTEST  _010203z5228.23N/02101.28E#Object');
    stations = store.snapshot();
    assert.deepEqual(stations.map((station) => station.callsign), ['SP8ABC-9']);
  } finally { store.dispose(); }
});

test('stores a wrapped position under its inner source', () => {
  const store = new StationStore(() => undefined);
  try {
    store.receive('SR0DZ>APDW16,SR5NWA*:}SQ2IBK>U2QU28,TCPIP,SR0DZ*:`0SZl4{[/>145.575MHz&', 'VHF');
    const [station] = store.snapshot();
    assert.equal(station.callsign, 'SQ2IBK');
    assert.equal(station.path, 'TCPIP,SR0DZ*');
    assert.equal(station.sourceInterface, 'VHF');
  } finally { store.dispose(); }
});

test('displays received positions even when the destination contains a space', () => {
  const store = new StationStore(() => undefined);
  try {
    store.receive('SP7FNU-4>RT 73,SR5NWA*,WIDE1*:!5217.44N/02104.70Ej000/037RETEVIS RT 73', 'DIGI');
    let station = store.snapshot()[0];
    assert.equal(station.callsign, 'SP7FNU-4');
    assert.equal(station.destination, 'RT 73');
    assert.equal(station.path, 'SR5NWA*,WIDE1*');
    assert.equal(station.sourceInterface, 'DIGI');
    assert.equal(station.latitude.toFixed(4), '52.2907');
    assert.equal(station.longitude.toFixed(4), '21.0783');
    assert.equal(station.symbol, '/j');
    assert.equal(station.decoded?.speedKnots, 37);
    store.receive('SP7FNU-4>RT 73,WIDE1-1:!5217.24N/02104.53Ej000/000RETEVIS RT 73', 'DIGI');
    station = store.snapshot()[0];
    assert.equal(store.snapshot().length, 1);
    assert.equal(station.latitude.toFixed(4), '52.2873');
    assert.equal(station.track.length, 2);
    assert.equal(station.comment, '000/000RETEVIS RT 73');
  } finally { store.dispose(); }
});

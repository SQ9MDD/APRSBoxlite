import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test, { mock } from 'node:test';
import bundledTocalls from '../src/data/tocalls.json' with { type: 'json' };

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

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test, { mock } from 'node:test';

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

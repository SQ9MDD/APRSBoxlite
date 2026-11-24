import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { KissFrameDecoder } from '../src/main/kissTcpRx.ts';

registerHooks({
  resolve(specifier, context, next) {
    return next(
      ['./aprsMessages', './aprsPosition', './kissTcpRx', '../messageGroups', '../aprsMessageControl'].includes(specifier) ? `${specifier}.ts` : specifier,
      context,
    );
  },
});
const { encodeBeacon, selectBeaconInterfaces, transmitBeacon } = await import('../src/main/aprsBeacon.ts');

const station = {
  callsign: 'SQ9MDD',
  ssid: '-8',
  location: '52.306167, 21.081167',
  comment: 'Test',
  symbolTable: '/',
  symbolCode: '>',
  symbolOverlay: '',
  beaconPath: 'WIDE1-1,WIDE2-1',
};

test('encodes the selected station position, symbol and path with APBOX1', () => {
  assert.deepEqual(new KissFrameDecoder().consume(encodeBeacon(station)), [
    'SQ9MDD-8>APBOX1,WIDE1-1,WIDE2-1:=5218.37N/02104.87E>Test',
  ]);
});

test('encodes alternate overlays and southern/western positions', () => {
  const frame = encodeBeacon({
    ...station,
    ssid: '-0',
    location: '-33.5, -70.25',
    symbolTable: '\\',
    symbolCode: '>',
    symbolOverlay: 'A',
    beaconPath: '',
  });
  assert.deepEqual(new KissFrameDecoder().consume(frame), [
    'SQ9MDD>APBOX1:=3330.00SA07015.00W>Test',
  ]);
});

test('normalizes minute rounding at coordinate boundaries', () => {
  const frame = encodeBeacon({
    ...station,
    location: '12.999999, 179.999999',
    beaconPath: '',
    comment: '',
  });
  assert.deepEqual(new KissFrameDecoder().consume(frame), [
    'SQ9MDD-8>APBOX1:=1300.00N/18000.00E>',
  ]);
});

test('rejects invalid station data and transmission path', () => {
  assert.throws(() => encodeBeacon({ ...station, location: '90.1, 20' }));
  assert.throws(() => encodeBeacon({ ...station, symbolOverlay: 'A' }));
  assert.throws(() => encodeBeacon({ ...station, beaconPath: 'WIDE1-1*' }));
  assert.throws(() => encodeBeacon({ ...station, comment: 'żółć' }));
});

test('automatically selects all available TX interfaces and respects explicit selection', () => {
  const items = [
    { id: 'radio', name: 'Radio', enabled: true, txBlocked: false },
    { id: 'internet', name: 'APRS-IS', enabled: true, txBlocked: false },
    { id: 'offline', name: 'Offline', enabled: true, txBlocked: false },
    { id: 'blocked', name: 'Blocked', enabled: true, txBlocked: true },
    { id: 'disabled', name: 'Disabled', enabled: false, txBlocked: false },
  ];
  const available = (item: { id: string }) => item.id !== 'offline';
  assert.deepEqual(selectBeaconInterfaces(items, '', available).map((item) => item.id), ['radio', 'internet']);
  assert.deepEqual(selectBeaconInterfaces(items, 'radio', available).map((item) => item.id), ['radio']);
  assert.throws(() => selectBeaconInterfaces(items, 'offline', available), /not connected/);
  assert.throws(() => selectBeaconInterfaces(items, 'blocked', available), /blocked/);
  assert.throws(() => selectBeaconInterfaces(items, '', () => false), /No connected/);
});

test('attempts every selected interface even if one fails', async () => {
  const items = [
    { id: 'radio', name: 'Radio', enabled: true, txBlocked: false },
    { id: 'internet', name: 'APRS-IS', enabled: true, txBlocked: false },
  ];
  const attempts: string[] = [];
  const frame = new Uint8Array([1]);
  const result = await transmitBeacon(items, frame, async (id, bytes) => {
    attempts.push(id);
    assert.equal(bytes, frame);
    if (id === 'radio') throw new Error('Disconnected');
  });
  assert.deepEqual(attempts, ['radio', 'internet']);
  assert.deepEqual(result.sent.map((item) => item.id), ['internet']);
  assert.equal(result.failed[0].error, 'Disconnected');
  await assert.rejects(transmitBeacon(items, frame, async () => { throw new Error('Offline'); }), /Offline/);
});

test('encodes an APRS status with the configured callsign and path', async () => {
  const { encodeStatus } = await import('../src/main/aprsBeacon.ts');
  assert.deepEqual(new KissFrameDecoder().consume(encodeStatus({ ...station, status: 'On air' })), [
    'SQ9MDD-8>APBOX1,WIDE1-1,WIDE2-1:>On air',
  ]);
  assert.throws(() => encodeStatus({ ...station, status: '  ' }));
  assert.throws(() => encodeStatus({ ...station, status: 'żółć' }));
});

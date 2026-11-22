import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { KissFrameDecoder } from '../src/main/kissTcpRx.ts';

registerHooks({
  resolve(specifier, context, next) {
    return next(
      specifier === './aprsMessages' ? './aprsMessages.ts' : specifier === '../aprsMessageControl' ? '../aprsMessageControl.ts' : specifier,
      context,
    );
  },
});
const { encodeBeacon } = await import('../src/main/aprsBeacon.ts');

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

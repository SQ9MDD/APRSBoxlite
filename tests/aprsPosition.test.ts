import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAprsPosition } from '../src/main/aprsPosition.ts';

// Position fixtures from reference/APRSBox-reference/tests/test_content_aprs.py.
test('decodes an uncompressed station position and comment', () => {
  const position = decodeAprsPosition(
    'SP8ABC-9>APRS:!5218.37N\\02104.87E-Test',
  );
  assert.ok(position);
  assert.equal(position.callsign, 'SP8ABC-9');
  assert.equal(position.latitude.toFixed(5), '52.30617');
  assert.equal(position.longitude.toFixed(5), '21.08117');
  assert.equal(position.symbol, '\\-');
  assert.equal(position.comment, 'Test');
});

test('decodes compressed positions with timestamps and overlay symbols', () => {
  const timestamped = decodeAprsPosition('SP8ABC-9>APRS:@010203z/4)HLSj:R> sT');
  assert.ok(timestamped);
  assert.equal(timestamped.latitude.toFixed(5), '52.22970');
  assert.equal(timestamped.longitude.toFixed(5), '21.01220');
  assert.equal(timestamped.symbol, '/>');

  const overlay = decodeAprsPosition(
    'M0IGA-9>APLRFT,WIDE1-1,WIDE2-1:!L2efTN.PAv:HQLoRa APRS 1200',
  );
  assert.ok(overlay);
  assert.equal(overlay.latitude.toFixed(5), '54.87469');
  assert.equal(overlay.longitude.toFixed(5), '-1.36868');
  assert.equal(overlay.symbol, 'Lv');
  assert.equal(overlay.comment, 'LoRa APRS 1200');
});

test('decodes Mic-E latitude and longitude from the destination and payload', () => {
  const position = decodeAprsPosition(
    'SO5AJM-7>URTW13,SR5NWR*,WIDE1*,WIDE2*:`14M^\\^]D[/"4N}Witam!',
  );
  assert.ok(position);
  assert.equal(position.latitude.toFixed(5), '52.78550');
  assert.equal(position.longitude.toFixed(5), '21.40817');
  assert.equal(position.symbol, 'D]');
});

test('ignores status, truncated positions and invalid coordinate fields', () => {
  for (const info of [
    '>Status',
    '!5218.37N/',
    '!5260.00N/02104.87E>',
    '!5218.37N/02199.87E>',
  ]) {
    assert.equal(decodeAprsPosition(`SP8ABC-9>APRS:${info}`), undefined);
  }
});

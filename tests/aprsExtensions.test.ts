import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAprsExtensions } from '../src/main/aprsExtensions.ts';

test('decodes APRSBox course, altitude, PHG and frequency extensions', () => {
  const comment =
    '243/002/A=000278 PHG5130 145.575MHz C123 +060 Back on track!';
  const decoded = decodeAprsExtensions(
    'SP8ABC>APRS:!' + comment,
    comment,
    '/>',
  );
  assert.equal(decoded.courseDegrees, 243);
  assert.equal(decoded.speedKnots, 2);
  assert.equal(decoded.altitudeFeet, 278);
  assert.deepEqual(decoded.phg, {
    powerWatts: 25,
    heightFeet: 20,
    gainDbi: 3,
    direction: 0,
  });
  assert.deepEqual(decoded.qsy, {
    frequencyMHz: 145.575,
    tone: 'C123',
    offsetKHz: 600,
  });
});

test('decodes weather without mistaking wind for station movement', () => {
  const comment = '090/010g015t020r000p000P000h50b10150';
  const decoded = decodeAprsExtensions('SP8WX>APRS:!' + comment, comment, '/_');
  assert.equal(decoded.courseDegrees, undefined);
  assert.equal(decoded.weather?.windDegrees, 90);
  assert.equal(decoded.weather?.windMph, 10);
  assert.equal(decoded.weather?.gustMph, 15);
  assert.equal(decoded.weather?.temperatureC?.toFixed(1), '-6.7');
  assert.equal(decoded.weather?.humidityPercent, 50);
  assert.equal(decoded.weather?.pressureHpa, 1015);
});

test('decodes Mic-E movement from APRSBox sample', () => {
  const packet = 'SO5AJM-7>URTW13,SR5NWR*,WIDE1*,WIDE2*:`14M^\\^]D[/"4N}Witam!';
  const decoded = decodeAprsExtensions(packet, '', 'D]');
  assert.equal(decoded.speedKnots, 666);
  assert.equal(decoded.courseDegrees, 66);
});

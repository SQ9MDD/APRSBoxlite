import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, next) {
    return next(specifier === './aprsPosition' ? `${specifier}.ts` : specifier, context);
  },
});
const { classifyTraffic } = await import('../src/main/trafficColors.ts');

test('classifies own beacons, messages and weather echoes like APRSBox', () => {
  assert.equal(classifyTraffic('SP9ABC-8>APBOX1:!5218.37N/02104.87E>Test', 'SP9ABC-8'), 'own-beacon');
  assert.equal(classifyTraffic('SP9ABC-8>APBOX1::SP8ABC   :ack42', 'SP9ABC-8'), 'own-message');
  assert.equal(classifyTraffic('SP9ABC-8>APBOX1:?APRS?', 'SP9ABC-8'), 'own-message');
  assert.equal(classifyTraffic('SP9ABC-5>APRS:!5218.37N/02104.87E_123/005', 'SP9ABC-8'), 'own-weather');
  assert.equal(classifyTraffic('SP9ABC>APRS:>Status', 'SP9ABC-0'), 'own-beacon');
  assert.equal(classifyTraffic('SP9ABC-7>APBOX1:>Status', 'SP9ABC-8'), undefined);
  assert.equal(classifyTraffic('SP8ABC>APBOX1::SP9ABC-8 :Hi', 'SP9ABC-8'), undefined);
});

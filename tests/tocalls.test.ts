import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupTocall } from '../src/main/tocalls.ts';

test('identifies exact and wildcard TOCALLs from the bundled APRSBox list', () => {
  assert.equal(lookupTocall('APIZCI'), 'hymTR IZCI Tracker');
  assert.equal(lookupTocall('apdw16-1'), 'DireWolf');
  assert.equal(lookupTocall('UNKNOWN'), undefined);
});

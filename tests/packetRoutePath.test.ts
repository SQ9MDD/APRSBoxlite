import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { routeSegments, routeCallsigns } from '../src/views/packetRoutePath.ts';

test('extracts only used RF hops and ignores third-party packets', () => {
  assert.deepEqual(routeCallsigns('SP1ABC-0>APRS,WIDE1-1:>direct'), ['SP1ABC']);
  assert.deepEqual(routeCallsigns('SP1ABC>APRS,SR1AAA,SR1BBB*,WIDE2-1:>status'), ['SP1ABC', 'SR1AAA', 'SR1BBB']);
  assert.deepEqual(routeCallsigns('SP1ABC>APRS,SR1AAA*,SR1BBB*:>status'), ['SP1ABC', 'SR1AAA', 'SR1BBB']);
  assert.deepEqual(routeCallsigns('SO5AJM-7>URTW13,SR5NWR*,WIDE1*,WIDE2*:`position'), ['SO5AJM-7', 'SR5NWR']);
  assert.deepEqual(routeCallsigns('SQ5WPR-9>APK102,SQ5AAG-2*,WIDE1*,SR5NEB*::SQ9MDD-15:ack00'), ['SQ5WPR-9', 'SQ5AAG-2', 'SR5NEB']);
  assert.deepEqual(routeCallsigns('SP1ABC>APRS,WIDE1*:>status'), ['SP1ABC', 'WIDE1']);
  assert.equal(routeCallsigns('SR1AAA>APRS:}SP1ABC>APRS:>status'), undefined);
});

test('marks only segments crossing unknown hops as approximate', () => {
  assert.deepEqual(routeSegments(['source', undefined, 'digi', 'receiver']), [
    { from: 'source', to: 'digi', approximate: true },
    { from: 'digi', to: 'receiver', approximate: false },
  ]);
  assert.deepEqual(routeSegments(['source', 'digi', undefined, 'receiver']), [
    { from: 'source', to: 'digi', approximate: false },
    { from: 'digi', to: 'receiver', approximate: true },
  ]);
  assert.deepEqual(routeSegments([undefined, 'receiver']), []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAprsIsGroups, normalizeMessageGroups, readMessageGroups } from '../src/messageGroups.ts';

test('normalizes separate group lists with reference defaults and validation', () => {
  assert.deepEqual(readMessageGroups(undefined), { rf: ['ALL', 'QST', 'CQ'], aprsIs: ['ALL', 'QST', 'CQ'] });
  assert.deepEqual(readMessageGroups({ rf: ['local'] }), { rf: ['LOCAL'], aprsIs: ['LOCAL'] });
  assert.deepEqual(readMessageGroups({ rf: [], aprsIs: [] }), { rf: [], aprsIs: [] });
  assert.deepEqual(normalizeMessageGroups('cq, LOCAL, Cq, NINE12345'), ['CQ', 'LOCAL', 'NINE12345']);
  for (const invalid of ['CQ,', 'CQ,,QST', 'BLN1', 'TOO LONG', 'TOOLONG123']) assert.throws(() => normalizeMessageGroups(invalid));
});

test('appends only missing APRS-IS group filters', () => {
  assert.equal(appendAprsIsGroups('r/52/21/25 g/cq/LOCAL b/SP5ABC', ['CQ', 'QST', 'LOCAL']), 'r/52/21/25 g/cq/LOCAL b/SP5ABC g/QST');
  assert.equal(appendAprsIsGroups('', ['CQ', 'ALL']), 'g/CQ/ALL');
  assert.equal(appendAprsIsGroups('t/m', []), 't/m');
});

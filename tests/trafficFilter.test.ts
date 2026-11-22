import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import type { TrafficMonitorFrame } from '../src/views/TrafficMonitorView.ts';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier === '../trafficLog' ? `${specifier}.ts` : specifier, context);
} });
const { filterTrafficFrames, renderTrafficEntries } = await import('../src/views/TrafficMonitorView.ts');

const frames: TrafficMonitorFrame[] = [
  { id: '1', receivedAt: '2026-11-22T12:00:00Z', interfaceId: 'vhf', interfaceName: 'VHF', source: 'kiss', direction: 'rx', packet: 'SQ9MDD-15>APBOX1:>Position' },
  { id: '2', receivedAt: '2026-11-22T12:00:01Z', interfaceId: 'uhf', interfaceName: 'UHF', source: 'kiss', direction: 'tx', packet: 'SP8ABC>APRS::SQ9MDD-15:hello' },
];

test('filters the interface, direction and frame with case-insensitive literal matching', () => {
  assert.deepEqual(filterTrafficFrames(frames, '  vhf  ').map((frame) => frame.id), ['1']);
  assert.deepEqual(filterTrafficFrames(frames, ' TX ').map((frame) => frame.id), ['2']);
  assert.deepEqual(filterTrafficFrames(frames, 'apbox1').map((frame) => frame.id), ['1']);
  assert.equal(filterTrafficFrames(frames, '.*').length, 0);
  assert.equal(filterTrafficFrames(frames, '   ').length, 2);
  assert.match(renderTrafficEntries(frames, 'not found'), /No matching frames/);
  assert.equal(frames.length, 2);
});

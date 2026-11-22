import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTrafficFrames, formatTrafficLog, trafficLogFilename } from '../src/trafficLog.ts';

test('formats filtered traffic in monitor order with UTC timestamps', () => {
  const frames = [
    { receivedAt: '2026-11-22T11:05:09.000Z', interfaceName: 'VHF', source: 'kiss', direction: 'rx' as const, packet: 'SQ9MDD-15>APBOX1:>Test' },
    { receivedAt: '2026-11-22T11:05:08.000Z', interfaceName: 'UHF', source: 'kiss', direction: 'tx' as const, packet: 'SP8ABC>APRS:Message' },
  ];
  assert.equal(formatTrafficLog(filterTrafficFrames(frames, ' vhf ')), '2026.11.22 11:05:09 UTC VHF RX SQ9MDD-15>APBOX1:>Test\n');
  assert.equal(formatTrafficLog([]), '');
  assert.equal(trafficLogFilename('sq9mdd-15', new Date(2026, 10, 22, 9, 8, 7)), 'SQ9MDD-15-2026-11-22-09-08-07-log.txt');
  assert.match(trafficLogFilename('../', new Date(2026, 10, 22)), /^APRSBOX-/);
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type net from 'node:net';
import type { TrafficFrame } from '../src/main/kissTcpRx.ts';

registerHooks({ resolve(specifier, context, next) {
  return next(['./kissTcpRx', './aprsPosition', './tocalls', './aprsExtensions', '../messageGroups', '../aprsMessageControl', '../aprsIsFilter'].includes(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { AprsIsRxService, makeAprsIsTarget, aprsIsPasscode } = await import('../src/main/aprsIsRx.ts');
const { encodeKissMessage, encodeKissFrame, MessageService } = await import('../src/main/aprsMessages.ts');
const { StationStore } = await import('../src/main/stationStore.ts');

class FakeSocket extends EventEmitter {
  destroyed = false;
  writes: string[] = [];
  setTimeout() { return this; }
  setKeepAlive() { return this; }
  setNoDelay() { return this; }
  write(data: string, callback?: (error?: Error) => void) { this.writes.push(data); callback?.(); return true; }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
}
const config = { id: 'internet', name: 'Internet', type: 'aprs-is', enabled: true, txBlocked: false, aprsIsServer: 'example.test:14580', aprsIsRadius: '25', reconnectTimeout: '5' };
const station = { callsign: 'SQ9MDD', ssid: '-15', location: '52.250000, 20.900000' };

test('forms range filter from configured location and rejects invalid settings', () => {
  assert.equal(aprsIsPasscode('N0CALL'), '13023');
  assert.equal(aprsIsPasscode('SQ9MDD-15'), aprsIsPasscode('SQ9MDD'));
  const target = makeAprsIsTarget(config, station);
  assert.equal(target?.login, 'SQ9MDD-15');
  assert.equal(target?.filter, 'r/52.25/20.9/25 g/ALL/QST/CQ');
  assert.equal(makeAprsIsTarget({ ...config, aprsIsFilter: 'r/52.25/20.9/25 b/SP5ABC' }, station)?.filter, 'r/52.25/20.9/25 b/SP5ABC g/ALL/QST/CQ');
  assert.equal(makeAprsIsTarget({ ...config, aprsIsFilter: 'b/SP5ABC\nfilter t/m' }, station), undefined);
  assert.equal(makeAprsIsTarget(config, { ...station, ssid: '-0' })?.login, 'SQ9MDD');
  assert.equal(makeAprsIsTarget(config, { ...station, location: 'invalid' }), undefined);
  assert.equal(makeAprsIsTarget({ ...config, aprsIsRadius: '0' }, station), undefined);
  assert.equal(makeAprsIsTarget({ ...config, aprsIsServer: 'bad\nserver:14580' }, station), undefined);
});

test('logs in, receives fragmented lines, sends only verified local packets, and reconnects on filter change', async () => {
  const sockets: FakeSocket[] = [];
  const frames: TrafficFrame[] = [];
  const statuses: string[] = [];
  const stations = new StationStore(() => undefined);
  const service = new AprsIsRxService((frame) => { frames.push(frame); if (frame.direction === 'rx') stations.receive(frame.packet, frame.interfaceName, frame); }, (_id, status) => statuses.push(status), '0.1.1-beta', () => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as net.Socket;
  });
  try {
    service.configure([config], station);
    const socket = sockets[0];
    socket.emit('connect');
    assert.equal(socket.writes[0], `user SQ9MDD-15 pass ${aprsIsPasscode('SQ9MDD')} vers APRSBoxLite 0.1.1-beta filter r/52.25/20.9/25 g/ALL/QST/CQ\r\n`);
    socket.emit('data', Buffer.from('# logresp SQ9MDD-15 unverified, server TEST\r\n'));
    socket.emit('data', Buffer.from('# server ready\r\nSP5ABC>APRS,TCPIP*,qAC,TEST:!5223.'));
    socket.emit('data', Buffer.from('45N/02101.23E>Test\r\ninvalid\r\n'));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].source, 'aprs-is');
    assert.equal(frames[0].packet, 'SP5ABC>APRS,TCPIP*,qAC,TEST:!5223.45N/02101.23E>Test');
    assert.equal(stations.snapshot()[0]?.callsign, 'SP5ABC');
    assert.equal(stations.snapshot()[0]?.sourceInterface, 'APRS-IS · Internet');
    assert.equal(stations.snapshot()[0]?.directHeardAt, undefined);
    socket.emit('data', Buffer.concat([Buffer.from('SP5XYZ>APRS:>Caf', 'ascii'), Buffer.from([0xe9]), Buffer.from('\r\n')]));
    assert.equal(frames[1].packet, 'SP5XYZ>APRS:>Café');
    const outgoing = encodeKissMessage('SQ9MDD-15', 'SP5ABC', 'Hello{00', 'WIDE2-1');
    await assert.rejects(service.transmit('internet', outgoing), /not verified/);
    socket.emit('data', Buffer.from('# logresp SQ9MDD-15 verified, server TEST\r\n'));
    assert.equal(service.canTransmit('internet'), true);
    await service.transmit('internet', outgoing);
    assert.equal(socket.writes[1], 'SQ9MDD-15>APBOX1,TCPIP*::SP5ABC   :Hello{00\r\n');
    assert.equal(frames[2].direction, 'tx');
    await assert.rejects(service.transmit('internet', encodeKissFrame('SP5ABC', '>not ours', '')), /Invalid local/);
    await assert.rejects(service.transmit('internet', encodeKissFrame('SQ9MDD-15', '}SP5ABC>APRS:>gated', '')), /Invalid local/);
    service.configure([{ ...config, txBlocked: true }], station);
    await assert.rejects(service.transmit('internet', outgoing), /blocked/);
    assert.equal(sockets.length, 1);
    service.configure([{ ...config, aprsIsRadius: '50' }], station);
    assert.equal(socket.destroyed, true);
    assert.equal(sockets.length, 2);
    sockets[1].emit('connect');
    assert.match(sockets[1].writes[0], /filter r\/52\.25\/20\.9\/50/);
    assert.ok(statuses.includes('connected'));
  } finally { service.stop(); stations.dispose(); }
});

test('receive-only messages cannot generate automatic transmissions', () => {
  let sends = 0;
  const service = new MessageService(() => 'SQ9MDD-15', async () => { sends++; }, () => undefined, [], () => ({ path: '', version: '1', position: () => new Uint8Array() }));
  try {
    service.receive('SP5ABC>APRS,TCPIP*::SQ9MDD-15:?VER{77', 'internet', false);
    service.receive('SP5ABC>APRS,TCPIP*::SQ9MDD-15:Hello{78', 'internet', false);
    assert.equal(sends, 0);
    assert.equal(service.snapshot().length, 2);
  } finally { service.dispose(); }
});

test('gates eligible RF frames only when enabled and verified, with duplicate and loop protection', () => {
  const socket = new FakeSocket();
  const frames: TrafficFrame[] = [];
  const service = new AprsIsRxService((frame) => frames.push(frame), () => undefined, '1', () => socket as unknown as net.Socket);
  const rf: TrafficFrame = { id: '1', receivedAt: new Date().toISOString(), interfaceId: 'radio', interfaceName: 'VHF', packet: 'SP5ABC>APRS,SP1DIG*,WIDE2-1:>Hello', source: 'kiss', direction: 'rx' };
  try {
    service.configure([config], station);
    socket.emit('connect');
    service.configure([{ ...config, aprsIsIgateRfToIs: true }], station);
    service.forwardRf(rf);
    assert.equal(socket.writes.length, 1);
    service.configure([config], station);
    socket.emit('data', Buffer.from('# logresp SQ9MDD-15 verified, server TEST\r\n'));
    service.forwardRf(rf);
    assert.equal(socket.writes.length, 1);
    service.configure([{ ...config, aprsIsIgateRfToIs: true }], station);
    service.forwardRf(rf);
    assert.equal(socket.writes[1], 'SP5ABC>APRS,SP1DIG*,WIDE2-1,qAO,SQ9MDD-15:>Hello\r\n');
    assert.equal(frames[0].direction, 'tx');
    service.forwardRf({ ...rf, packet: 'SP5ABC>APRS,OTHER*:>Hello' });
    service.forwardRf({ ...rf, source: 'aprs-is' });
    service.forwardRf({ ...rf, direction: 'tx' });
    for (const packet of ['SP7FNU-4>RT 73,WIDE1-1:!5217.24N/02104.53Ej000/000RETEVIS RT 73', 'SP5ABC>APRS,NOGATE:>x', 'SP5ABC>APRS,RFONLY:>x', 'SP5ABC>APRS,TCPIP*:>x', 'SP5ABC>APRS,TCPIP1*:>x', 'SP5ABC>APRS,TCPXX-1:>x', 'SP5ABC>APRS,nogate*:>x', 'SP5ABC>APRS,RFONLY:}SP5XYZ>APRS:>inner', 'SP5ABC>APRS:}SP5XYZ>APRS,NOGATE:>inner', 'SP5ABC>APRS:}malformed', 'SP5ABC>APRS,qAR,OTHER:>x', 'SP5ABC>APRS:?APRS', 'SP5ABC>APRS:>bad\ufffd', 'SP5ABC>APRS:}SP5XYZ>APRS,TCPXX*:>x']) service.forwardRf({ ...rf, packet });
    assert.equal(socket.writes.length, 2);
    service.forwardRf({ ...rf, packet: 'SP5ABC>APRS:}SP5XYZ>APRS,WIDE1*:>inner' });
    assert.equal(socket.writes[2], 'SP5XYZ>APRS,WIDE1*,SP5ABC,qAO,SQ9MDD-15:>inner\r\n');
    service.configure([{ ...config, aprsIsIgateRfToIs: true, txBlocked: true }], station);
    service.forwardRf({ ...rf, packet: 'SP5ABC>APRS:>blocked' });
    assert.equal(socket.writes.length, 3);
    assert.equal(socket.destroyed, false);
  } finally { service.stop(); }
});

test('drops stale RF packets and does not queue packets while the connection is busy', () => {
  class BusySocket extends FakeSocket {
    writableLength = 0;
    pending?: (error?: Error) => void;
    write(data: string, callback?: (error?: Error) => void) {
      this.writes.push(data);
      if (callback) this.pending = callback;
      return true;
    }
  }
  const socket = new BusySocket();
  const service = new AprsIsRxService(() => undefined, () => undefined, '1', () => socket as unknown as net.Socket);
  const rf: TrafficFrame = { id: '1', receivedAt: new Date().toISOString(), interfaceId: 'radio', interfaceName: 'VHF', packet: 'SP5ABC>APRS:>first', source: 'kiss', direction: 'rx' };
  try {
    service.configure([{ ...config, aprsIsIgateRfToIs: true }], station);
    socket.emit('connect');
    socket.emit('data', Buffer.from('# logresp SQ9MDD-15 verified, server TEST\r\n'));
    service.forwardRf({ ...rf, receivedAt: new Date(Date.now() - 60001).toISOString() });
    service.forwardRf({ ...rf, receivedAt: 'invalid' });
    socket.writableLength = 1;
    service.forwardRf(rf);
    assert.equal(socket.writes.length, 1);
    socket.writableLength = 0;
    service.forwardRf(rf);
    service.forwardRf({ ...rf, packet: 'SP5ABC>APRS:>second' });
    assert.equal(socket.writes.length, 2);
    socket.pending?.();
    assert.equal(socket.writes.length, 2);
    service.forwardRf({ ...rf, packet: 'SP5ABC>APRS:>third' });
    assert.equal(socket.writes.length, 3);
  } finally { service.stop(); }
});

test('sends editable filters at login and reconnects when they change', () => {
  const sockets: FakeSocket[] = [];
  const service = new AprsIsRxService(() => undefined, () => undefined, '1', () => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as net.Socket;
  });
  try {
    service.configure([{ ...config, aprsIsFilter: 'r/52.25/20.9/25 b/SP5ABC' }], station);
    sockets[0].emit('connect');
    assert.match(sockets[0].writes[0], / filter r\/52\.25\/20\.9\/25 b\/SP5ABC g\/ALL\/QST\/CQ\r\n$/);
    service.configure([{ ...config, aprsIsFilter: 't/m' }], station);
    assert.equal(sockets[0].destroyed, true);
    sockets[1].emit('connect');
    assert.match(sockets[1].writes[0], / filter t\/m g\/ALL\/QST\/CQ\r\n$/);
    service.configure([{ ...config, aprsIsFilter: '' }], station);
    sockets[2].emit('connect');
    assert.match(sockets[2].writes[0], / filter g\/ALL\/QST\/CQ\r\n$/);
  } finally { service.stop(); }
});

test('changes group subscriptions by reconnecting and preserves user filters', () => {
  const sockets: FakeSocket[] = [];
  const service = new AprsIsRxService(() => undefined, () => undefined, '1', () => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as net.Socket;
  });
  try {
    const item = { ...config, aprsIsFilter: 'r/52/21/25 g/CQ b/SP5ABC' };
    service.configure([item], station, ['CQ', 'LOCAL']);
    sockets[0].emit('connect');
    assert.match(sockets[0].writes[0], /filter r\/52\/21\/25 g\/CQ b\/SP5ABC g\/LOCAL\r\n$/);
    service.configure([item], station, ['CQ', 'OTHER']);
    assert.equal(sockets[0].destroyed, true);
    sockets[1].emit('connect');
    assert.match(sockets[1].writes[0], /g\/CQ b\/SP5ABC g\/OTHER\r\n$/);
    service.configure([item], station, []);
    sockets[2].emit('connect');
    assert.match(sockets[2].writes[0], /filter r\/52\/21\/25 g\/CQ b\/SP5ABC\r\n$/);
  } finally { service.stop(); }
});

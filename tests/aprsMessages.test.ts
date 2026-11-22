import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { registerHooks } from 'node:module';
import { KissFrameDecoder } from '../src/main/kissTcpRx.ts';
import type { AprsMessage } from '../src/types.ts';

registerHooks({
  resolve(specifier, context, next) {
    return next(['../messageGroups', '../aprsMessageControl', './aprsPosition', './kissTcpRx'].includes(specifier) ? `${specifier}.ts` : specifier, context);
  },
});

const { MessageService, encodeKissFrame, encodeKissMessage, parseAprsMessage } = await import('../src/main/aprsMessages.ts');
test('decodes the sender of APRSBox third-party messages', () => {
  const parsed = parseAprsMessage('SR0DZ>APDW16,SR5NWA*,WIDE1*:}SQ2IBK>APRS,TCPIP,SR0DZ*::SQ9MDD-4 :test third-party{12');
  assert.equal(parsed?.sender, 'SQ2IBK');
  assert.equal(parsed?.addressee, 'SQ9MDD-4');
  assert.equal(parsed?.text, 'test third-party');
  assert.equal(parsed?.number, '12');
});

test('sends queries once without a message number or ACK retries', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const frames: Uint8Array[] = [];
  const service = new MessageService(() => 'SQ9MDD-4', async (_id, frame) => { frames.push(frame); }, () => undefined);
  try {
    await service.send('SP8ABC', '?APRSP', 'VHF', 'WIDE1-1');
    assert.equal(new KissFrameDecoder().consume(frames[0])[0], 'SQ9MDD-4>APBOX1,WIDE1-1::SP8ABC   :?APRSP');
    assert.equal(service.snapshot()[0].status, 'sent');
    mock.timers.tick(120_000);
    assert.equal(frames.length, 1);
  } finally { service.dispose(); mock.timers.reset(); }
});

test('answers the numbered TH-D75 query even when its number was used by another message', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const frames: Array<{ interfaceId: string; frame: Uint8Array }> = [];
  const initial: AprsMessage[] = [{ id: 'old', sender: 'SQ9MDD-7', recipient: 'SQ9MDD-15', text: 'Earlier message', direction: 'rx', status: 'received', number: '76', path: '', interfaceId: 'BT', attempts: 0, createdAt: new Date().toISOString() }];
  const service = new MessageService(() => 'SQ9MDD-15', async (interfaceId, frame) => { frames.push({ interfaceId, frame }); }, () => undefined, initial, () => ({ version: '0.1.1-beta', path: '', position: () => new Uint8Array() }));
  try {
    const packet = 'SQ9MDD-7>APK005,RFONLY::SQ9MDD-15:?VER{76';
    assert.deepEqual(parseAprsMessage(packet), { sender: 'SQ9MDD-7', addressee: 'SQ9MDD-15', text: '?VER', number: '76', replyAck: undefined });
    service.receive(packet, 'BT');
    service.receive(packet, 'BT');
    mock.timers.tick(5000);
    await Promise.resolve();
    assert.equal(frames.length, 1);
    assert.equal(frames[0].interfaceId, 'BT');
    assert.equal(new KissFrameDecoder().consume(frames[0].frame)[0], 'SQ9MDD-15>APBOX1::SQ9MDD-7 :APRSBox Lite 0.1.1-beta');
    assert.deepEqual(service.snapshot().slice(1).map((message) => message.text), ['?VER', 'APRSBox Lite 0.1.1-beta']);
  } finally { service.dispose(); mock.timers.reset(); }
});

test('answers the observed TH-D75 KISS frame with a trailing carriage return', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const frames: Array<{ interfaceId: string; frame: Uint8Array }> = [];
  const service = new MessageService(() => 'SQ9MDD-15', async (interfaceId, frame) => { frames.push({ interfaceId, frame }); }, () => undefined, [], () => ({ version: '0.1.1-beta', path: '', position: () => new Uint8Array() }));
  const address = (call: string, ssid: number, last: boolean) => [
    ...Buffer.from(call.padEnd(6, ' ')).map((byte) => byte << 1),
    0x60 | (ssid << 1) | (last ? 1 : 0),
  ];
  try {
    const raw = Buffer.from([0xc0, 0x00, ...address('APK005', 0, false), ...address('SQ9MDD', 7, false), ...address('RFONLY', 0, true), 0x03, 0xf0, ...Buffer.from(':SQ9MDD-15:?VER{77\r'), 0xc0]);
    const received = new KissFrameDecoder().consume(raw)[0];
    assert.equal(received, 'SQ9MDD-7>APK005,RFONLY::SQ9MDD-15:?VER{77\r');
    assert.equal(parseAprsMessage(received)?.number, '77');
    assert.equal(parseAprsMessage(received)?.text, '?VER');
    service.receive(received, 'VHF-DIGI');
    service.receive(received, 'VHF-DIGI');
    mock.timers.tick(5000);
    await Promise.resolve();
    assert.equal(frames.length, 1);
    assert.equal(frames[0].interfaceId, 'VHF-DIGI');
    assert.equal(new KissFrameDecoder().consume(frames[0].frame)[0], 'SQ9MDD-15>APBOX1::SQ9MDD-7 :APRSBox Lite 0.1.1-beta');
    assert.equal(parseAprsMessage('SQ9MDD-7>APK005::SQ9MDD-15:?VER{77\r\n')?.number, '77');
  } finally { service.dispose(); mock.timers.reset(); }
});

test('answers addressed APRS queries once and does not ACK numbered queries', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const frames: Uint8Array[] = [];
  const service = new MessageService(() => 'SQ9MDD-4', async (_id, frame) => { frames.push(frame); }, () => undefined, [], () => ({
    version: '0.1.1-beta', path: 'WIDE1-1',
    position: () => encodeKissFrame('SQ9MDD-4', '=5213.78N/02100.73E>Test', 'WIDE1-1'),
  }));
  const decode = (frame: Uint8Array) => new KissFrameDecoder().consume(frame)[0];
  try {
    const numbered = 'SP8ABC>APK005,RFONLY::SQ9MDD-4 :?APRS{49';
    service.receive(numbered, 'VHF');
    service.receive(numbered, 'VHF');
    assert.equal(frames.length, 0);
    assert.deepEqual(service.snapshot().map((item) => item.text), ['?APRS', 'Queries: ?APRS ?APRSP ?VER']);
    mock.timers.tick(4999);
    assert.equal(frames.length, 0);
    mock.timers.tick(1);
    await Promise.resolve();
    assert.equal(decode(frames[0]), 'SQ9MDD-4>APBOX1,WIDE1-1::SP8ABC   :Queries: ?APRS ?APRSP ?VER');
    service.receive('SP8ABC>APRS::SQ9MDD-4 :?APRSP', 'VHF');
    service.receive('SP8ABC>APRS::SQ9MDD-4 :?VER', 'VHF');
    await Promise.resolve();
    assert.equal(decode(frames[1]), 'SQ9MDD-4>APBOX1,WIDE1-1:=5213.78N/02100.73E>Test');
    assert.equal(decode(frames[2]), 'SQ9MDD-4>APBOX1,WIDE1-1::SP8ABC   :APRSBox Lite 0.1.1-beta');
    service.receive('SP8ABC>APRS::ALL      :?VER{88', 'VHF');
    service.receive('SQ9MDD-4>APRS::SQ9MDD-4 :?VER{89', 'VHF');
    service.receive('SP8ABC>APRS::SQ9MDD-4 :?UNKNOWN{90', 'VHF');
    mock.timers.tick(90_000);
    await Promise.resolve();
    assert.equal(frames.length, 3);
    assert.equal(service.snapshot().filter((item) => item.direction === 'tx').length, 3);
  } finally { service.dispose(); mock.timers.reset(); }
});

test('retries a failed position response as a beacon, respecting the transmit error', async () => {
  let blocked = true;
  const frames: Uint8Array[] = [];
  const service = new MessageService(() => 'SQ9MDD-4', async (_id, frame) => {
    if (blocked) throw new Error('TX blocked');
    frames.push(frame);
  }, () => undefined, [], () => ({ version: '1', path: '', position: () => encodeKissFrame('SQ9MDD-4', '=5213.78N/02100.73E>Test', '') }));
  try {
    service.receive('SP8ABC>APRS::SQ9MDD-4 :?APRSP', 'VHF');
    await Promise.resolve();
    const response = service.snapshot().find((item) => item.direction === 'tx');
    assert.equal(response?.status, 'failed');
    assert.match(response?.error ?? '', /TX blocked/);
    blocked = false;
    await service.retry(response!.id);
    assert.equal(new KissFrameDecoder().consume(frames[0])[0], 'SQ9MDD-4>APBOX1:=5213.78N/02100.73E>Test');
  } finally { service.dispose(); }
});

test('encodes APRS message into a KISS AX.25 UI frame', () => {
  const decoder = new KissFrameDecoder();
  const frame = encodeKissMessage(
    'SQ9MDD-8',
    'SP8ABC-9',
    'Hello{00',
    'WIDE1-1,WIDE2-1',
  );
  assert.deepEqual(decoder.consume(frame), [
    'SQ9MDD-8>APBOX1,WIDE1-1,WIDE2-1::SP8ABC-9 :Hello{00',
  ]);
  assert.throws(() =>
    encodeKissMessage('SQ9MDD-8', 'SP8ABC-9', 'Hello', 'WIDE1-1*'),
  );
});

test('parses numbered messages and ACK/REJ reply acknowledgements', () => {
  assert.deepEqual(
    parseAprsMessage('SP8ABC-9>APRS,WIDE1-1*::SQ9MDD-8 :Hello{AB}CD'),
    {
      sender: 'SP8ABC-9',
      addressee: 'SQ9MDD-8',
      text: 'Hello',
      number: 'AB',
      replyAck: 'CD',
    },
  );
  assert.equal(
    parseAprsMessage('SP8ABC-9>APRS::SQ9MDD-8 :ackAB')?.control,
    'ack',
  );
  assert.equal(
    parseAprsMessage('SP8ABC-9>APRS::SQ9MDD-8 :rejAB')?.control,
    'rej',
  );
  assert.equal(parseAprsMessage('SP8ABC-9>APRS:>status'), undefined);
  assert.equal(parseAprsMessage('SP8ABC-9>APRS::SQ9MDD-8 :ack00   ')?.control, 'ack');
  assert.equal(parseAprsMessage('SP8ABC-9>APRS::SQ9MDD-8 :ack00{AB')?.control, 'ack');
  assert.equal(parseAprsMessage('SP8ABC-9>APRS::SQ9MDD-8 :AA:automatycza odp')?.text, 'AA:automatycza odp');
});

test('sends a numbered message and accepts only the matching peer ACK', async () => {
  const frames: Uint8Array[] = [];
  let snapshot: AprsMessage[] = [];
  const service = new MessageService(
    () => 'SQ9MDD-8',
    async (_id, frame) => {
      frames.push(frame);
    },
    (messages) => {
      snapshot = messages;
    },
  );
  try {
    await service.send('SP8ABC-9', 'Hello', 'tcp', 'WIDE1-1');
    assert.equal(snapshot[0].status, 'pending');
    assert.equal(snapshot[0].number, '00');
    service.receive('OTHER>APRS::SQ9MDD-8 :ack00', 'tcp');
    assert.equal(snapshot[0].status, 'pending');
    service.receive('SP8ABC-9>APRS::SQ9MDD-8 :ack00', 'tcp');
    assert.equal(snapshot[0].status, 'acked');
    assert.equal(frames.length, 1);
  } finally {
    service.dispose();
  }
});

test('deduplicates numbered RX messages while ACKing retransmissions', async () => {
  const frames: Uint8Array[] = [];
  let snapshot: AprsMessage[] = [];
  const service = new MessageService(
    () => 'SQ9MDD-8',
    async (_id, frame) => {
      frames.push(frame);
    },
    (messages) => {
      snapshot = messages;
    },
  );
  try {
    const packet = 'SP8ABC-9>APRS,WIDE1-1*::SQ9MDD-8 :Hello{A1';
    service.receive(packet, 'tcp');
    service.receive(packet, 'tcp');
    assert.equal(snapshot.length, 1);
    assert.equal(frames.length, 2);
    assert.equal(
      new KissFrameDecoder().consume(frames[0])[0],
      'SQ9MDD-8>APBOX1::SP8ABC-9 :ackA1',
    );
    service.receive('SP8ABC-9>APRS::QST      :Group', 'tcp');
    assert.equal(snapshot.length, 2);
    assert.equal(frames.length, 2);
  } finally {
    service.dispose();
  }
});

test('marks blocked transmission failed and keeps it after one hour', async () => {
  mock.timers.enable({
    apis: ['Date', 'setTimeout', 'setInterval'],
    now: 1000,
  });
  let snapshot: AprsMessage[] = [];
  const service = new MessageService(
    () => 'SQ9MDD-8',
    async () => {
      throw new Error('TX blocked');
    },
    (messages) => {
      snapshot = messages;
    },
  );
  try {
    await service.send('SP8ABC-9', 'Hello', 'blocked', '');
    assert.equal(snapshot[0].status, 'failed');
    assert.match(snapshot[0].error ?? '', /TX blocked/);
    mock.timers.tick(60 * 60 * 1000);
    assert.equal(service.snapshot().length, 1);
  } finally {
    service.dispose();
    mock.timers.reset();
  }
});

test('restores conversations without retransmitting pending messages', async () => {
  const initial: AprsMessage[] = [{ id: 'pending', sender: 'SQ9MDD-8', recipient: 'SP8ABC-9', text: 'Hello', direction: 'tx', status: 'pending', number: '00', path: '', interfaceId: 'tcp', attempts: 1, createdAt: new Date().toISOString() }];
  let transmissions = 0;
  const service = new MessageService(() => 'SQ9MDD-8', async () => { transmissions++; }, () => undefined, initial);
  try {
    assert.equal(service.snapshot()[0].status, 'failed');
    assert.match(service.snapshot()[0].error ?? '', /restart/);
    assert.equal(transmissions, 0);
    await service.send('SP8ABC-9', 'Another', 'tcp', '');
    assert.equal(service.snapshot()[1].number, '01');
  } finally { service.dispose(); }
});

test('retries after 8, 16 and 32 seconds, then fails after the final ACK wait', async () => {
  mock.timers.enable({
    apis: ['Date', 'setTimeout', 'setInterval'],
    now: 1000,
  });
  let transmissions = 0;
  let snapshot: AprsMessage[] = [];
  const service = new MessageService(
    () => 'SQ9MDD-8',
    async () => {
      transmissions++;
    },
    (messages) => {
      snapshot = messages;
    },
  );
  try {
    await service.send('SP8ABC-9', 'Hello', 'tcp', '');
    for (const delay of [8000, 16000, 32000]) {
      mock.timers.tick(delay);
      await Promise.resolve();
      await Promise.resolve();
    }
    assert.equal(transmissions, 4);
    assert.equal(snapshot[0].status, 'pending');
    mock.timers.tick(30000);
    assert.equal(snapshot[0].status, 'failed');
    assert.equal(snapshot[0].error, 'No ACK received.');
  } finally {
    service.dispose();
    mock.timers.reset();
  }
});

test('accepts the reported nine-character SSID ACK and stops retries despite repeated copies', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
  const frames: Uint8Array[] = [];
  let snapshot: AprsMessage[] = [];
  const service = new MessageService(
    () => 'SQ9MDD-15',
    async (_id, frame) => { frames.push(frame); },
    (messages) => { snapshot = messages; },
  );
  try {
    await service.send('SQ5WPR-9', 'test', 'VHF', '');
    assert.equal(new KissFrameDecoder().consume(frames[0])[0], 'SQ9MDD-15>APBOX1::SQ5WPR-9 :test{00');
    mock.timers.tick(8000);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(frames.length, 2);
    service.receive('SQ5WPR-9>APK102,WIDE1-1,WIDE2-1::SQ9MDD-15:ack00', 'VHF');
    assert.equal(snapshot[0].status, 'acked');
    service.receive('SQ5WPR-9>APK102,SR5NWA*,WIDE1*,WIDE2-1::SQ9MDD-15:ack00', 'VHF');
    service.receive('SQ5WPR-9>APK102,SQ5AAG-2*,WIDE1*,SR5NEB*::SQ9MDD-15:ack00', 'VHF');
    service.receive('SQ5WPR-9>APK102::SQ9MDD-15:ack00{AB', 'VHF');
    mock.timers.tick(90_000);
    await Promise.resolve();
    assert.equal(frames.length, 2);
    assert.equal(snapshot[0].status, 'acked');
    assert.equal(snapshot.length, 1);
  } finally {
    service.dispose();
    mock.timers.reset();
  }
});

test('deleting a conversation cancels retries and keeps other conversations', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const frames: Uint8Array[] = [];
  const changes: AprsMessage[][] = [];
  const service = new MessageService(() => 'SQ9MDD-4', async (_id, frame) => { frames.push(frame); }, (messages) => changes.push(messages));
  try {
    await service.send('SP8ABC', 'Hello', 'VHF', '');
    service.receive('SP8ABC>APRS::SQ9MDD-4 :Hi', 'VHF');
    service.receive('SP8XYZ>APRS::SQ9MDD-4 :Other', 'VHF');
    service.receive('SP8ABC>APRS::ALL      :Group', 'VHF');
    service.deleteConversation('SP8ABC');
    assert.deepEqual(service.snapshot().map((message) => message.text), ['Other', 'Group']);
    assert.deepEqual(changes.at(-1)?.map((message) => message.text), ['Other', 'Group']);
    mock.timers.tick(120_000);
    assert.equal(frames.length, 1);
    service.deleteConversation('ALL');
    assert.deepEqual(service.snapshot().map((message) => message.text), ['Other']);
  } finally { service.dispose(); mock.timers.reset(); }
});

test('tracks unread incoming conversations until opened or deleted', () => {
  const service = new MessageService(() => 'SQ9MDD-4', async () => undefined, () => undefined);
  try {
    service.receive('SP8ABC>APRS::SQ9MDD-4 :Hello', 'VHF', false);
    service.receive('SP8XYZ>APRS::SQ9MDD-4 :Other', 'VHF', false);
    service.receive('SP8DEF>APRS::SQ9MDD-4 :?VER{77', 'VHF', false);
    assert.deepEqual(service.snapshot().map((message) => message.unread), [true, true, false]);
    service.markConversationRead('SP8ABC');
    assert.deepEqual(service.snapshot().map((message) => message.unread), [false, true, false]);
    service.deleteConversation('SP8XYZ');
    assert.equal(service.snapshot().some((message) => message.unread), false);
    service.receive('SP8ABC>APRS::ALL      :Group', 'VHF', false);
    assert.equal(service.snapshot().at(-1)?.unread, true);
    service.markConversationRead('ALL');
    assert.equal(service.snapshot().at(-1)?.unread, false);
  } finally { service.dispose(); }
});

test('separates RF and APRS-IS message groups without ACKs or query responses', async () => {
  const frames: Uint8Array[] = [];
  const groups = { rf: ['LOCALRF', 'NINE12345'], aprsIs: ['LOCALIS', 'NINE12345'] };
  const service = new MessageService(() => 'SQ9MDD-4', async (_id, frame) => { frames.push(frame); }, () => undefined, [], () => ({ version: '1', path: '', position: () => new Uint8Array() }), () => groups, (id) => id === 'internet');
  try {
    service.receive('SP8ABC>APRS::LOCALRF  :RF{11', 'radio');
    service.receive('SP8ABC>APRS::LOCALRF  :Wrong network{12', 'internet');
    service.receive('SP8XYZ>APRS::LOCALIS  :Internet{13', 'internet');
    service.receive('SP8XYZ>APRS::LOCALIS  :Wrong network{14', 'radio');
    service.receive('SP8XYZ>APRS::NINE12345:?VER{15', 'internet');
    service.receive('SP8XYZ>APRS::UNKNOWN  :Ignored{16', 'radio');
    assert.deepEqual(service.snapshot().map((message) => [message.recipient, message.group]), [['LOCALRF', true], ['LOCALIS', true], ['NINE12345', true]]);
    assert.equal(frames.length, 0);
    await service.send('NINE12345', 'Hello group', 'internet', '');
    assert.match(new KissFrameDecoder().consume(frames[0])[0], /::NINE12345:Hello group$/);
    assert.equal(service.snapshot().at(-1)?.number, undefined);
    service.markConversationRead('NINE12345');
    assert.equal(service.snapshot().find((message) => message.recipient === 'NINE12345' && message.direction === 'rx')?.unread, false);
    service.deleteConversation('NINE12345');
    assert.equal(service.snapshot().some((message) => message.recipient === 'NINE12345'), false);
  } finally { service.dispose(); }
});

test('automatic sending uses one message number and a single ACK stops retries', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const transmissions: Array<{ id: string; frame: Uint8Array }> = [];
  const service = new MessageService(() => 'SQ9MDD-4', async (id, frame) => {
    for (const target of id ? [id] : ['radio', 'internet']) transmissions.push({ id: target, frame });
  }, () => undefined);
  try {
    await service.send('SP8ABC', 'Hello', '', '');
    assert.equal(transmissions.length, 2);
    const decoded = transmissions.map(({ frame }) => new KissFrameDecoder().consume(frame)[0]);
    assert.equal(decoded[0], decoded[1]);
    const message = service.snapshot()[0];
    assert.equal(message.interfaceId, '');
    service.receive(`SP8ABC>APRS::SQ9MDD-4 :ack${message.number}`, 'internet');
    assert.equal(service.snapshot()[0].status, 'acked');
    mock.timers.tick(120_000);
    assert.equal(transmissions.length, 2);
  } finally { service.dispose(); mock.timers.reset(); }
});

test('automatic mode recognizes a group configured only for APRS-IS', async () => {
  const groups = { rf: [], aprsIs: ['NINE12345'] };
  const sent: Uint8Array[] = [];
  const service = new MessageService(() => 'SQ9MDD-4', async (_id, frame) => { sent.push(frame); }, () => undefined, [], undefined, () => groups);
  try {
    await service.send('NINE12345', 'Group', '', '');
    assert.match(new KissFrameDecoder().consume(sent[0])[0], /::NINE12345:Group$/);
    assert.equal(service.snapshot()[0].number, undefined);
  } finally { service.dispose(); }
});

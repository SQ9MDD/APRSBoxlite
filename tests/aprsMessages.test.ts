import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  MessageService,
  encodeKissMessage,
  parseAprsMessage,
} from '../src/main/aprsMessages.ts';
import { KissFrameDecoder } from '../src/main/kissTcpRx.ts';
import type { AprsMessage } from '../src/types.ts';

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

test('marks blocked transmission failed and expires messages from RAM', async () => {
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
    assert.equal(snapshot.length, 0);
  } finally {
    service.dispose();
    mock.timers.reset();
  }
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

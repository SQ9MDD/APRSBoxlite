import assert from 'node:assert/strict';
import test from 'node:test';
import { availableMessageInterfaces, sendMessageOnInterfaces } from '../src/main/messageTransport.ts';

const interfaces = [
  { id: 'radio', name: 'Radio', enabled: true, txBlocked: false },
  { id: 'internet', name: 'APRS-IS', enabled: true, txBlocked: false },
  { id: 'offline', name: 'Offline', enabled: true, txBlocked: false },
  { id: 'blocked', name: 'Blocked', enabled: true, txBlocked: true },
  { id: 'disabled', name: 'Disabled', enabled: false, txBlocked: false },
];

test('selects connected TX-capable interfaces and sends through each one', async () => {
  const targets = availableMessageInterfaces(interfaces, (item) => item.id !== 'offline');
  assert.deepEqual(targets.map((item) => item.id), ['radio', 'internet']);
  const sent: string[] = [];
  await sendMessageOnInterfaces(targets, new Uint8Array([1]), async (id) => { sent.push(id); });
  assert.deepEqual(sent, ['radio', 'internet']);
});

test('attempts all interfaces and reports partial or total failure', async () => {
  const targets = interfaces.slice(0, 2);
  const failed = await sendMessageOnInterfaces(targets, new Uint8Array(), async (id) => { if (id === 'radio') throw new Error('offline'); });
  assert.equal(failed[0].interface.id, 'radio');
  await assert.rejects(sendMessageOnInterfaces([], new Uint8Array(), async () => {}), /No connected/);
  await assert.rejects(sendMessageOnInterfaces(targets, new Uint8Array(), async () => { throw new Error('offline'); }), /Radio: offline.*APRS-IS: offline/);
});

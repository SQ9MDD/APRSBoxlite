import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MessageStorage } from '../src/main/messageStorage.ts';
import type { AprsMessage } from '../src/types.ts';

const message: AprsMessage = { id: '1', sender: 'SP8ABC', recipient: 'SQ9MDD-8', text: 'Hello', direction: 'rx', status: 'received', path: '', interfaceId: 'tcp', attempts: 0, createdAt: '2020-01-01T00:00:00.000Z' };

test('saves and restores ordered message history after restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aprsbox-messages-'));
  try {
    const storage = new MessageStorage(directory);
    assert.deepEqual(await storage.load(), []);
    const first = storage.save([message]);
    const second = storage.save([message, { ...message, id: '2', text: 'Reply' }]);
    await Promise.all([first, second]);
    await storage.flush();
    const restored = await new MessageStorage(directory).load();
    assert.deepEqual(restored.map((item) => item.text), ['Hello', 'Reply']);
    assert.equal(restored[0].createdAt, message.createdAt);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('rejects a damaged history without changing the file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aprsbox-messages-'));
  try {
    const file = path.join(directory, 'messages.json');
    await fs.writeFile(file, '{invalid');
    await assert.rejects(new MessageStorage(directory).load());
    assert.equal(await fs.readFile(file, 'utf8'), '{invalid');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createStatusScheduler } from '../src/main/statusScheduler.ts';

test('sends status on its interval and stops when disabled or empty', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let settings = { callsign: 'SQ9MDD', status: 'On air', statusInterval: '30 minutes' };
  let sent = 0;
  const scheduler = createStatusScheduler(() => settings, async () => { sent++; });
  try {
    scheduler.schedule();
    mock.timers.tick(30 * 60_000 - 1);
    assert.equal(sent, 0);
    mock.timers.tick(1);
    assert.equal(sent, 1);
    await Promise.resolve();
    mock.timers.tick(30 * 60_000);
    assert.equal(sent, 2);
    settings = { ...settings, statusInterval: 'Never' };
    scheduler.schedule();
    await Promise.resolve();
    mock.timers.tick(120 * 60_000);
    assert.equal(sent, 2);
    settings = { ...settings, statusInterval: '60 minutes', status: '' };
    scheduler.schedule();
    mock.timers.tick(120 * 60_000);
    assert.equal(sent, 2);
  } finally { scheduler.dispose(); mock.timers.reset(); }
});

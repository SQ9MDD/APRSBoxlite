import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { AprsMessage } from '../src/types.ts';

registerHooks({ resolve(specifier, context, next) {
  return next(['../aprsMessageControl', '../components/escapeHtml'].includes(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { renderMessageHistory } = await import('../src/views/MessagesView.ts');

test('hides received control messages without hiding ordinary replies', () => {
  const message: AprsMessage = { id: '1', sender: 'SQ5WPR-9', recipient: 'SQ9MDD-15', text: 'ack00', direction: 'rx', status: 'received', path: '', interfaceId: 'VHF', attempts: 0, createdAt: new Date().toISOString() };
  const result = renderMessageHistory([message, { ...message, id: '2', text: 'AA:automatycza odp' }], 'SQ5WPR-9');
  assert.doesNotMatch(result, /ack00/);
  assert.match(result, /AA:automatycza odp/);
});

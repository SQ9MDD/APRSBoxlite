import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { AprsMessage } from '../src/types.ts';

registerHooks({ resolve(specifier, context, next) {
  return next(['../aprsMessageControl', '../components/escapeHtml'].includes(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { renderMessageHistory, renderMessagesView } = await import('../src/views/MessagesView.ts');

test('hides received control messages without hiding ordinary replies', () => {
  const message: AprsMessage = { id: '1', sender: 'SQ5WPR-9', recipient: 'SQ9MDD-15', text: 'ack00', direction: 'rx', status: 'received', path: '', interfaceId: 'VHF', attempts: 0, createdAt: new Date().toISOString() };
  const result = renderMessageHistory([message, { ...message, id: '2', text: 'AA:automatycza odp' }], 'SQ5WPR-9');
  assert.doesNotMatch(result, /ack00/);
  assert.match(result, /AA:automatycza odp/);
});

test('keeps the chosen interface selected while disconnected', () => {
  const interfaces = [
    { id: 'ble', name: 'BT', type: 'kiss-ble' as const, enabled: true, txBlocked: false, hostPort: '', serialDevice: '', baudRate: '', reconnectTimeout: '' },
    { id: 'tcp', name: 'VHF', type: 'kiss-tcp' as const, enabled: true, txBlocked: false, hostPort: '', serialDevice: '', baudRate: '', reconnectTimeout: '' },
  ];
  const html = renderMessagesView([], 'SP5ABC', interfaces, { ble: 'disconnected', tcp: 'connected' }, 'ble').html;
  assert.match(html, /value="ble" selected disabled/);
  assert.doesNotMatch(html, /value="tcp" selected/);
});

test('renders the path for the active conversation safely', () => {
  const html = renderMessagesView([], 'SP5ABC', [], {}, '', 'WIDE1-1,WIDE2-1').html;
  assert.match(html, /name="path" value="WIDE1-1,WIDE2-1"/);
  const escaped = renderMessagesView([], 'SP5ABC', [], {}, '', '" onfocus="bad').html;
  assert.match(escaped, /value="&quot; onfocus=&quot;bad"/);
});

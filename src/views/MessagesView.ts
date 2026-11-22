import { escapeHtml } from '../components/escapeHtml';
import type { AprsMessage } from '../types';
import type { InterfaceSettings } from './SettingsView';
import { parseMessageControl } from '../aprsMessageControl';

function visibleMessage(message: AprsMessage): boolean {
  return message.direction !== 'rx' || !parseMessageControl(message.text);
}

function conversationFor(message: AprsMessage): string {
  return message.direction === 'tx'
    ? message.recipient
    : ['ALL', 'QST', 'CQ'].includes(message.recipient)
      ? message.recipient
      : message.sender;
}

export function renderMessageHistory(
  messages: AprsMessage[],
  recipient: string | undefined,
): string {
  const items = messages.filter(
    (message) => visibleMessage(message) && conversationFor(message) === recipient,
  );
  if (!items.length)
    return '<p class="messages-empty">No messages in this conversation.</p>';
  return items
    .map((message) => {
      const status =
        message.direction === 'tx'
          ? `<span class="message-status" title="${escapeHtml(message.error ?? '')}">${escapeHtml(message.status.toUpperCase())}${message.attempts ? ` · ${message.attempts}/4` : ''}</span>`
          : '';
      const retry =
        message.direction === 'tx' &&
        (message.status === 'failed' || message.status === 'rejected')
          ? `<button type="button" data-retry-message="${escapeHtml(message.id)}">Retry</button>`
          : '';
      return `<article class="message-bubble ${message.direction}"><strong>${escapeHtml(message.sender)}</strong><p>${escapeHtml(message.text)}</p><small>${escapeHtml(new Date(message.createdAt).toLocaleString())} ${status} ${retry}</small></article>`;
    })
    .join('');
}

export function renderMessagesView(
  messages: AprsMessage[],
  recipient: string | undefined,
  interfaces: InterfaceSettings[],
  statuses: Record<string, string>,
  selectedInterfaceId = '',
  path = '',
): { html: string } {
  const conversations = [
    ...new Set([...messages].reverse().filter(visibleMessage).map(conversationFor)),
  ];
  if (recipient && !conversations.includes(recipient))
    conversations.unshift(recipient);
  const eligible = interfaces.filter(
    (item) => item.enabled && !item.txBlocked,
  );
  const options = eligible
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}" ${item.id === selectedInterfaceId ? 'selected' : ''} ${statuses[item.id] === 'connected' ? '' : 'disabled'}>${escapeHtml(item.name || item.hostPort || item.serialDevice || item.id)} · ${escapeHtml(statuses[item.id] ?? 'disconnected')}</option>`,
    )
    .join('');
  return {
    html: `<div class="messages-layout"><aside class="messages-sidebar"><div class="messages-header"><strong>Conversations</strong></div><form data-message-new class="messages-new"><label>Start new conversation<input name="recipient" maxlength="9" placeholder="SP9XYZ-7" autocomplete="off" required></label><button class="outline-button" type="submit">Open</button></form><div class="messages-conversations">${conversations.map((call) => `<button type="button" data-message-conversation="${escapeHtml(call)}" class="${call === recipient ? 'is-selected' : ''}">${escapeHtml(call)}</button>`).join('')}</div></aside><section class="messages-thread"><header class="messages-header"><strong>${recipient ? escapeHtml(recipient) : 'Select a conversation'}</strong></header><div class="messages-history" data-message-history>${recipient ? renderMessageHistory(messages, recipient) : '<p class="messages-empty">Select or open a conversation.</p>'}</div><form data-message-send class="messages-composer"><label>Message <textarea name="text" rows="3" maxlength="67" placeholder="Type APRS message" ${recipient ? '' : 'disabled'} required></textarea></label><div class="messages-controls"><label>Interface<select name="interfaceId" required><option value="">Select interface</option>${options}</select></label><label>Path<input name="path" value="${escapeHtml(path)}" placeholder="WIDE2-1" maxlength="71"></label><button class="primary-button" type="submit" ${recipient ? '' : 'disabled'}>Send</button></div><small>Printable ASCII, up to 67 characters. Direct messages request an ACK.</small><p class="message-error" data-message-error role="alert"></p></form></section></div>`,
  };
}

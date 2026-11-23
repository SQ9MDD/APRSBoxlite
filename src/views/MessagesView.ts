import { readMessageGroups } from '../messageGroups';
import type { MessageGroups } from '../messageGroups';
import { escapeHtml } from '../components/escapeHtml';
import type { AprsMessage } from '../types';
import type { InterfaceSettings } from './SettingsView';
import { parseMessageControl } from '../aprsMessageControl';

const deleteIcon = new URL('../components/icons/delete-outline.svg', import.meta.url).href;

function visibleMessage(message: AprsMessage): boolean {
  return message.direction !== 'rx' || !parseMessageControl(message.text);
}

function conversationFor(message: AprsMessage): string {
  return message.direction === 'tx'
    ? message.recipient
    : (message.group ?? ['ALL', 'QST', 'CQ'].includes(message.recipient))
      ? message.recipient
      : message.sender;
}

export function isVisibleInConversation(message: AprsMessage, recipient: string): boolean {
  return visibleMessage(message) && conversationFor(message) === recipient;
}

export function renderMessageHistory(
  messages: AprsMessage[],
  recipient: string | undefined,
): string {
  const items = messages.filter(
    (message) => !!recipient && isVisibleInConversation(message, recipient),
  );
  if (!items.length)
    return '<p class="messages-empty">No messages in this conversation.</p>';
  return items
    .map((message) => {
      const status =
        message.direction === 'tx'
          ? `<span class="message-status" title="${escapeHtml(message.error ?? '')}">${escapeHtml(message.status.toUpperCase())}${message.number && message.attempts ? ` · ${message.attempts}/4` : ''}</span>`
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
  groups: MessageGroups = readMessageGroups(undefined),
): { html: string } {
  const visibleMessages = messages.filter(visibleMessage);
  const conversations = [
    ...new Set([...visibleMessages].reverse().map(conversationFor)),
  ];
  if (recipient && !conversations.includes(recipient))
    conversations.unshift(recipient);
  const unreadCounts = new Map<string, number>();
  for (const message of visibleMessages) {
    if (message.direction !== 'rx' || !message.unread) continue;
    const call = conversationFor(message);
    unreadCounts.set(call, (unreadCounts.get(call) ?? 0) + 1);
  }
  const conversationRows = conversations.map((call) => {
    const unread = unreadCounts.get(call) ?? 0;
    const unreadLabel = `${unread} unread ${unread === 1 ? 'message' : 'messages'}`;
    const classes = [
      call === recipient ? 'is-selected' : '',
      unread ? 'has-unread' : '',
    ].filter(Boolean).join(' ');
    const label = unread ? `${call}, ${unreadLabel}` : call;
    const badge = unread
      ? `<span class="messages-unread-count" aria-hidden="true">${unread}</span>`
      : '';
    return `<div class="messages-conversation-row"><button type="button" data-message-conversation="${escapeHtml(call)}" class="${classes}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span class="messages-conversation-name">${escapeHtml(call)}</span>${badge}</button><button type="button" data-delete-conversation="${escapeHtml(call)}" class="messages-delete" title="Delete conversation ${escapeHtml(call)}" aria-label="Delete conversation ${escapeHtml(call)}"><img src="${deleteIcon}" alt=""></button></div>`;
  }).join('');
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
    html: `<div class="messages-layout"><aside class="messages-sidebar"><div class="messages-header"><strong>Conversations</strong></div><form data-message-new class="messages-new"><label>Start new conversation<input name="recipient" maxlength="9" placeholder="SP9XYZ-7" autocomplete="off" required></label><button class="outline-button" type="submit">Open</button></form><div class="messages-conversations">${conversationRows}</div><form data-message-groups class="messages-groups"><strong>Message settings</strong><label>RF groups<input name="rf" value="${escapeHtml(groups.rf.join(', '))}" placeholder="CQ, YAESU, LOCAL" autocomplete="off" spellcheck="false"></label><label>APRS-IS groups<input name="aprsIs" value="${escapeHtml(groups.aprsIs.join(', '))}" placeholder="CQ, YAESU, LOCAL" autocomplete="off" spellcheck="false"></label><button class="outline-button" type="submit">Save settings</button><small data-message-groups-status role="status"></small></form></aside><section class="messages-thread"><header class="messages-header"><strong>${recipient ? escapeHtml(recipient) : 'Select a conversation'}</strong></header><div class="messages-history" data-message-history>${recipient ? renderMessageHistory(messages, recipient) : '<p class="messages-empty">Select or open a conversation.</p>'}</div><form data-message-send class="messages-composer"><label>Message <textarea name="text" rows="3" maxlength="67" placeholder="Type APRS message" ${recipient ? '' : 'disabled'} required></textarea></label><div class="messages-controls"><label>Interface<select name="interfaceId"><option value="" ${selectedInterfaceId ? '' : 'selected'}>Automatic (all connected TX interfaces)</option>${selectedInterfaceId && !eligible.some((item) => item.id === selectedInterfaceId) ? `<option value="${escapeHtml(selectedInterfaceId)}" selected disabled>Previously selected interface unavailable</option>` : ''}${options}</select></label><label>Path<input name="path" value="${escapeHtml(path)}" placeholder="WIDE2-1" maxlength="71"></label><button class="primary-button" type="submit" ${recipient ? '' : 'disabled'}>Send</button></div><small>Printable ASCII, up to 67 characters. Direct messages request an ACK.</small><p class="message-error" data-message-error role="alert"></p></form></section></div>`,
  };
}

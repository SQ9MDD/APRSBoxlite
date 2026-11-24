import { readMessageGroups } from '../messageGroups';
import type { MessageGroups } from '../messageGroups';
import type { AprsMessage } from '../types';
import { parseMessageControl } from '../aprsMessageControl';
import { unwrapAprsPacket } from './aprsPosition';
import { KissFrameDecoder } from './kissTcpRx';

const CALLSIGN = /^[A-Z0-9]{1,6}(?:-(?:[0-9]|1[0-5]))?$/;
const LEGACY_GROUPS = new Set(['ALL', 'QST', 'CQ']);
function conversationFor(message: AprsMessage): string {
  return message.direction === 'tx' ? message.recipient : (message.group ?? LEGACY_GROUPS.has(message.recipient)) ? message.recipient : message.sender;
}
function normalizeMessageAddress(value: string): string {
  const address = value.trim().toUpperCase();
  if (/^[A-Z0-9]{1,9}$/.test(address)) return address;
  return normalizeCallsign(address);
}
const RETRY_DELAYS = [8_000, 16_000, 32_000];
const DEDUPLICATION_AGE = 60 * 60 * 1000;
const MAX_MESSAGES = 1000;
type QuerySettings = { path: string; version: string; position: () => Uint8Array };

export function normalizeCallsign(value: string): string {
  const callsign = value.trim().toUpperCase();
  if (!CALLSIGN.test(callsign)) throw new Error('Invalid callsign or SSID.');
  return callsign.replace(/-0$/, '');
}

export function encodeKissMessage(
  source: string,
  recipient: string,
  text: string,
  path: string,
): Uint8Array {
  const info = `:${normalizeMessageAddress(recipient).padEnd(9, ' ')}:${text}`;
  return encodeKissFrame(source, info, path);
}

export function encodeKissFrame(
  source: string,
  info: string,
  path: string,
): Uint8Array {
  const parseAddress = (value: string) => {
    const [call, ssid = '0'] = normalizeCallsign(value).split('-');
    return { call, ssid: Number(ssid) };
  };
  const hops = path.trim()
    ? path
        .toUpperCase()
        .split(',')
        .map((item) => item.trim())
    : [];
  if (hops.length > 8 || hops.some((hop) => !hop))
    throw new Error('Invalid digipeater path.');
  const addresses = ['APBOX1', source, ...hops].map(parseAddress);
  const data: number[] = [];
  addresses.forEach(({ call, ssid }, index) => {
    for (const char of call.padEnd(6, ' ')) data.push(char.charCodeAt(0) << 1);
    data.push(0x60 | (ssid << 1) | (index === addresses.length - 1 ? 1 : 0));
  });
  if (!/^[\x20-\x7e]+$/.test(info))
    throw new Error('Message must contain printable ASCII characters only.');
  data.push(3, 0xf0, ...Buffer.from(info, 'ascii'));
  const escaped: number[] = [0xc0, 0];
  for (const byte of data) {
    if (byte === 0xc0) escaped.push(0xdb, 0xdc);
    else if (byte === 0xdb) escaped.push(0xdb, 0xdd);
    else escaped.push(byte);
  }
  escaped.push(0xc0);
  return Uint8Array.from(escaped);
}

export function parseAprsMessage(packet: string):
  | {
      sender: string;
      addressee: string;
      text: string;
      number?: string;
      replyAck?: string;
      control?: 'ack' | 'rej';
    }
  | undefined {
  const effectivePacket = unwrapAprsPacket(packet);
  const header = effectivePacket?.match(/^([A-Z0-9-]+)>[^:]+::(.{9}):(.+)$/is);
  if (!header) return undefined;
  let sender: string;
  try {
    sender = normalizeCallsign(header[1]);
  } catch {
    return undefined;
  }
  const addressee = header[2].trim().toUpperCase().replace(/-0$/, '');
  // Some TNCs include a line terminator in the AX.25 information field.
  const field = header[3].replace(/[\r\n]+$/, '');
  if (!field) return undefined;
  const control = parseMessageControl(field);
  if (control)
    return {
      sender,
      addressee,
      text: '',
      number: control.number,
      control: control.control,
    };
  const message = field.match(
    /^(.*?)(?:\{([A-Z0-9]{1,5})(?:}([A-Z0-9]{0,5}))?)?$/is,
  );
  if (!message || !message[1]) return undefined;
  const numberedControl = parseMessageControl(message[1]);
  if (numberedControl) return {
    sender, addressee, text: '', number: numberedControl.number,
    control: numberedControl.control,
  };
  return {
    sender,
    addressee,
    text: message[1],
    number: message[2]?.toUpperCase(),
    replyAck: message[3]?.toUpperCase(),
  };
}

export class MessageService {
  private messages: AprsMessage[] = [];
  private unreadIds = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private acknowledgements = new Set<ReturnType<typeof setTimeout>>();
  private nextNumber = 0;
  private readonly ownCallsign: () => string;
  private readonly transmit: (
    interfaceId: string,
    frame: Uint8Array,
  ) => Promise<void>;
  private readonly onChange: (messages: AprsMessage[]) => void;
  private readonly querySettings?: (sender: string) => QuerySettings;
  private readonly groups: () => MessageGroups;
  private readonly isAprsIs: (interfaceId: string) => boolean;

  constructor(
    ownCallsign: () => string,
    transmit: (interfaceId: string, frame: Uint8Array) => Promise<void>,
    onChange: (messages: AprsMessage[]) => void,
    initialMessages: AprsMessage[] = [],
    querySettings?: (sender: string) => QuerySettings,
    groups: () => MessageGroups = () => readMessageGroups(undefined),
    isAprsIs: (interfaceId: string) => boolean = () => false,
  ) {
    this.ownCallsign = ownCallsign;
    this.transmit = transmit;
    this.onChange = onChange;
    this.querySettings = querySettings;
    this.groups = groups;
    this.isAprsIs = isAprsIs;
    this.messages = structuredClone(initialMessages.slice(-MAX_MESSAGES)).map((message) =>
      message.status === 'pending'
        ? { ...message, status: 'failed', error: 'Interrupted by application restart. Retry if needed.' }
        : message,
    );
  }

  snapshot(): AprsMessage[] {
    return structuredClone(this.messages.map((message) => ({ ...message, unread: this.unreadIds.has(message.id) })));
  }

  markConversationRead(recipient: string): void {
    const target = normalizeMessageAddress(recipient);
    let changed = false;
    for (const message of this.messages) {
      const conversation = conversationFor(message);
      if (conversation === target && this.unreadIds.delete(message.id)) changed = true;
    }
    if (changed) this.publish();
  }

  deleteConversation(recipient: string): void {
    const target = normalizeMessageAddress(recipient);
    const removed = this.messages.filter((message) =>
      conversationFor(message) === target,
    );
    if (!removed.length) return;
    for (const message of removed) {
      this.unreadIds.delete(message.id);
      clearTimeout(this.timers.get(message.id));
      this.timers.delete(message.id);
    }
    const ids = new Set(removed.map((message) => message.id));
    this.messages = this.messages.filter((message) => !ids.has(message.id));
    this.publish();
  }

  async send(
    recipient: string,
    text: string,
    interfaceId: string,
    path: string,
  ): Promise<void> {
    const source = normalizeCallsign(this.ownCallsign());
    const target = normalizeMessageAddress(recipient);
    const groups = this.groups();
    const group = interfaceId ? (this.isAprsIs(interfaceId) ? groups.aprsIs : groups.rf).includes(target) : groups.rf.includes(target) || groups.aprsIs.includes(target);
    if (!group) normalizeCallsign(target);
    const body = text.trim();
    if (
      !body ||
      body.length > 67 ||
      !/^[\x20-\x7e]+$/.test(body) ||
      /[{}]/.test(body)
    )
      throw new Error(
        'Use 1–67 printable ASCII characters, excluding { and }.',
      );
    const number = group || body.startsWith('?') ? undefined : this.allocateNumber(target);
    const info = body + (number ? `{${number}` : '');
    const frame = encodeKissMessage(source, target, info, path);
    const message: AprsMessage = {
      id: crypto.randomUUID(),
      sender: source,
      recipient: target,
      text: body,
      direction: 'tx',
      ...(group ? { group: true } : {}),
      status: 'pending',
      number,
      path: path.toUpperCase(),
      interfaceId,
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(message);
    this.publish();
    await this.attempt(message, frame);
  }

  receive(packet: string, interfaceId: string, allowAutomaticResponses = true): void {
    const parsed = parseAprsMessage(packet);
    if (!parsed) return;
    let local: string;
    try {
      local = normalizeCallsign(this.ownCallsign());
    } catch {
      return;
    }
    if (parsed.sender === local) return;
    const direct = parsed.addressee === local;
    const groups = this.groups();
    const group = !direct && (this.isAprsIs(interfaceId) ? groups.aprsIs : groups.rf).includes(parsed.addressee);
    if (!direct && !group) return;
    if (parsed.control) {
      if (direct)
        this.resolveAcknowledgement(
          parsed.sender,
          parsed.number!,
          parsed.control,
        );
      return;
    }
    const isQuery = parsed.text.startsWith('?');
    if (direct && !isQuery && parsed.replyAck)
      this.resolveAcknowledgement(parsed.sender, parsed.replyAck, 'ack');
    const duplicate = this.messages.some(
      (message) =>
        message.direction === 'rx' &&
        Date.now() - Date.parse(message.createdAt) < DEDUPLICATION_AGE &&
        message.sender === parsed.sender &&
        message.recipient === parsed.addressee &&
        (parsed.number
          ? message.number === parsed.number && (!isQuery || message.text === parsed.text)
          : !isQuery && !message.number &&
            message.text === parsed.text &&
            Date.now() - Date.parse(message.createdAt) < 30_000),
    );
    if (!duplicate) {
      const messageId = crypto.randomUUID();
      if (!isQuery || !direct) this.unreadIds.add(messageId);
      this.messages.push({
        id: messageId,
        sender: parsed.sender,
        recipient: parsed.addressee,
        text: parsed.text,
        direction: 'rx',
        ...(group ? { group: true } : {}),
        status: 'received',
        number: parsed.number,
        path: isQuery ? (unwrapAprsPacket(packet)?.match(/^[^>]+>[^,:]+(?:,([^:]*))?:/)?.[1] ?? '') : '',
        interfaceId,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
      this.publish();
    }
    if (direct && isQuery) {
      if (!duplicate && allowAutomaticResponses) this.respondToQuery(local, parsed.sender, parsed.text, parsed.number, interfaceId);
      return;
    }
    if (direct && parsed.number && allowAutomaticResponses) {
      const ack = encodeKissMessage(
        local,
        parsed.sender,
        `ack${parsed.number}`,
        '',
      );
      void this.transmit(interfaceId, ack).catch(() => undefined);
      if (this.acknowledgements.size >= MAX_MESSAGES) return;
      const timer = setTimeout(() => {
        this.acknowledgements.delete(timer);
        void this.transmit(interfaceId, ack).catch(() => undefined);
      }, 30_000);
      timer.unref();
      this.acknowledgements.add(timer);
    }
  }

  private respondToQuery(local: string, sender: string, text: string, number: string | undefined, interfaceId: string): void {
    const query = text.trim().toUpperCase().split(/\s+/)[0];
    if (!this.querySettings || !['?APRS', '?APRS?', '?APRSP', '?VER', '?APRSV'].includes(query)) return;
    let settings: QuerySettings;
    let frame: Uint8Array;
    let response: string;
    try {
      settings = this.querySettings(sender);
      if (query === '?APRSP') {
        frame = settings.position();
        // The frame is an ordinary beacon, but its payload is shown in the conversation.
        const position = new KissFrameDecoder().consume(frame)[0];
        if (!position) return;
        response = position.slice(position.indexOf(':') + 1);
      } else {
        response = query === '?APRS' || query === '?APRS?' ? 'Queries: ?APRS ?APRSP ?VER' : `APRSBox Lite ${settings.version}`;
        frame = encodeKissMessage(local, sender, response, settings.path);
      }
    } catch { return; }
    const message: AprsMessage = {
      id: crypto.randomUUID(), sender: local, recipient: sender, text: response,
      direction: 'tx', status: 'pending', path: settings.path, interfaceId, attempts: 0,
      createdAt: new Date().toISOString(),
      ...(query === '?APRSP' ? { kind: 'position-response' as const } : {}),
    };
    this.messages.push(message);
    this.publish();
    if (!number) { void this.attempt(message, frame); return; }
    const timer = setTimeout(() => {
      this.timers.delete(message.id);
      void this.attempt(message, frame);
    }, 5_000);
    timer.unref();
    this.timers.set(message.id, timer);
  }

  async retry(id: string): Promise<void> {
    const message = this.messages.find(
      (item) => item.id === id && item.direction === 'tx',
    );
    if (
      !message ||
      (message.status !== 'failed' && message.status !== 'rejected')
    )
      throw new Error('Message cannot be retried.');
    if (normalizeCallsign(message.sender) !== normalizeCallsign(this.ownCallsign()))
      throw new Error('Switch to the original station identity before retrying this message.');
    const frame = message.kind === 'position-response'
      ? encodeKissFrame(message.sender, message.text, message.path)
      : encodeKissMessage(message.sender, message.recipient, message.text + (message.number ? `{${message.number}` : ''), message.path);
    message.attempts = 0;
    message.status = 'pending';
    message.error = undefined;
    this.publish();
    await this.attempt(message, frame);
  }

  cancelPending(reason = 'Cancelled by station profile change.'): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.acknowledgements) clearTimeout(timer);
    this.timers.clear();
    this.acknowledgements.clear();
    for (const message of this.messages) {
      if (message.direction === 'tx' && message.status === 'pending') {
        message.status = 'failed';
        message.error = reason;
      }
    }
    this.publish();
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.acknowledgements) clearTimeout(timer);
    this.timers.clear();
    this.acknowledgements.clear();
    this.messages = [];
    this.unreadIds.clear();
  }

  private allocateNumber(recipient: string): string {
    for (let i = 0; i < 1296; i++) {
      const number = (this.nextNumber++ % 1296)
        .toString(36)
        .toUpperCase()
        .padStart(2, '0');
      if (
        !this.messages.some(
          (message) =>
            message.direction === 'tx' &&
            message.recipient === recipient &&
            message.number === number &&
            (message.status === 'pending' || Date.now() - Date.parse(message.createdAt) < DEDUPLICATION_AGE),
        )
      )
        return number;
    }
    throw new Error('No message numbers available for this recipient.');
  }

  private async attempt(
    message: AprsMessage,
    frame: Uint8Array,
  ): Promise<void> {
    if (message.status !== 'pending') return;
    message.attempts++;
    try {
      await this.transmit(message.interfaceId, frame);
      if (!this.messages.includes(message) || message.status !== 'pending')
        return;
      if (!message.number) {
        message.status = 'sent';
        this.publish();
        return;
      }
      const delay = RETRY_DELAYS[message.attempts - 1] ?? 30_000;
      const timer = setTimeout(() => {
        this.timers.delete(message.id);
        if (message.status !== 'pending') return;
        if (message.attempts >= 4) {
          message.status = 'failed';
          message.error = 'No ACK received.';
          this.publish();
        } else void this.attempt(message, frame);
      }, delay);
      timer.unref();
      this.timers.set(message.id, timer);
    } catch (error) {
      if (!this.messages.includes(message) || message.status !== 'pending')
        return;
      message.status = 'failed';
      message.error =
        error instanceof Error ? error.message : 'Transmission failed.';
    }
    this.publish();
  }

  private resolveAcknowledgement(
    sender: string,
    number: string,
    control: 'ack' | 'rej',
  ): void {
    const message = this.messages.findLast(
      (item) =>
        item.direction === 'tx' &&
        item.sender === normalizeCallsign(this.ownCallsign()) &&
        item.recipient === sender &&
        item.number === number &&
        (item.status === 'pending' || item.status === 'failed'),
    );
    if (!message) return;
    clearTimeout(this.timers.get(message.id));
    this.timers.delete(message.id);
    message.status = control === 'ack' ? 'acked' : 'rejected';
    message.error = undefined;
    this.publish();
  }

  private publish(): void {
    while (this.messages.length > MAX_MESSAGES) {
      const removed = this.messages.shift()!;
      this.unreadIds.delete(removed.id);
      clearTimeout(this.timers.get(removed.id));
      this.timers.delete(removed.id);
    }
    this.onChange(this.snapshot());
  }
}

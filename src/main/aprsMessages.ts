import type { AprsMessage } from '../types';

const CALLSIGN = /^[A-Z0-9]{1,6}(?:-(?:[0-9]|1[0-5]))?$/;
const GROUPS = new Set(['ALL', 'QST', 'CQ']);
const RETRY_DELAYS = [8_000, 16_000, 32_000];
const MAX_AGE = 60 * 60 * 1000;
const MAX_MESSAGES = 1000;

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
  const info = `:${normalizeCallsign(recipient).padEnd(9, ' ')}:${text}`;
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
  const header = packet.match(/^([A-Z0-9-]+)>[^:]+::(.{9}):(.+)$/is);
  if (!header) return undefined;
  let sender: string;
  try {
    sender = normalizeCallsign(header[1]);
  } catch {
    return undefined;
  }
  const addressee = header[2].trim().toUpperCase().replace(/-0$/, '');
  const field = header[3];
  const control = field.match(/^(ack|rej)([A-Z0-9]{1,5})(?:}[A-Z0-9]{0,5})?$/i);
  if (control)
    return {
      sender,
      addressee,
      text: '',
      number: control[2].toUpperCase(),
      control: control[1].toLowerCase() as 'ack' | 'rej',
    };
  const message = field.match(
    /^(.*?)(?:\{([A-Z0-9]{1,5})(?:}([A-Z0-9]{0,5}))?)?$/is,
  );
  if (!message || !message[1]) return undefined;
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
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private acknowledgements = new Set<ReturnType<typeof setTimeout>>();
  private nextNumber = 0;
  private cleanup: ReturnType<typeof setInterval>;
  private readonly ownCallsign: () => string;
  private readonly transmit: (
    interfaceId: string,
    frame: Uint8Array,
  ) => Promise<void>;
  private readonly onChange: (messages: AprsMessage[]) => void;

  constructor(
    ownCallsign: () => string,
    transmit: (interfaceId: string, frame: Uint8Array) => Promise<void>,
    onChange: (messages: AprsMessage[]) => void,
  ) {
    this.ownCallsign = ownCallsign;
    this.transmit = transmit;
    this.onChange = onChange;
    this.cleanup = setInterval(() => this.publish(), 30_000);
    this.cleanup.unref();
  }

  snapshot(): AprsMessage[] {
    const cutoff = Date.now() - MAX_AGE;
    return structuredClone(
      this.messages.filter((message) => Date.parse(message.createdAt) > cutoff),
    );
  }

  async send(
    recipient: string,
    text: string,
    interfaceId: string,
    path: string,
  ): Promise<void> {
    const source = normalizeCallsign(this.ownCallsign());
    const target = normalizeCallsign(recipient);
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
    const group = GROUPS.has(target);
    const number = group ? undefined : this.allocateNumber(target);
    const info = body + (number ? `{${number}` : '');
    const frame = encodeKissMessage(source, target, info, path);
    const message: AprsMessage = {
      id: crypto.randomUUID(),
      sender: source,
      recipient: target,
      text: body,
      direction: 'tx',
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

  receive(packet: string, interfaceId: string): void {
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
    if (!direct && !GROUPS.has(parsed.addressee)) return;
    if (parsed.control) {
      if (direct)
        this.resolveAcknowledgement(
          parsed.sender,
          parsed.number!,
          parsed.control,
        );
      return;
    }
    if (direct && parsed.replyAck)
      this.resolveAcknowledgement(parsed.sender, parsed.replyAck, 'ack');
    const duplicate = this.messages.some(
      (message) =>
        message.direction === 'rx' &&
        message.sender === parsed.sender &&
        message.recipient === parsed.addressee &&
        (parsed.number
          ? message.number === parsed.number
          : !message.number &&
            message.text === parsed.text &&
            Date.now() - Date.parse(message.createdAt) < 30_000),
    );
    if (!duplicate) {
      this.messages.push({
        id: crypto.randomUUID(),
        sender: parsed.sender,
        recipient: parsed.addressee,
        text: parsed.text,
        direction: 'rx',
        status: 'received',
        number: parsed.number,
        path: '',
        interfaceId,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
      this.publish();
    }
    if (direct && parsed.number) {
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

  async retry(id: string): Promise<void> {
    const message = this.messages.find(
      (item) => item.id === id && item.direction === 'tx',
    );
    if (
      !message ||
      (message.status !== 'failed' && message.status !== 'rejected')
    )
      throw new Error('Message cannot be retried.');
    const frame = encodeKissMessage(
      message.sender,
      message.recipient,
      message.text + (message.number ? `{${message.number}` : ''),
      message.path,
    );
    message.attempts = 0;
    message.status = 'pending';
    message.error = undefined;
    this.publish();
    await this.attempt(message, frame);
  }

  dispose(): void {
    clearInterval(this.cleanup);
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.acknowledgements) clearTimeout(timer);
    this.timers.clear();
    this.acknowledgements.clear();
    this.messages = [];
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
            message.status === 'pending',
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
    const message = this.messages.find(
      (item) =>
        item.direction === 'tx' &&
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
    const cutoff = Date.now() - MAX_AGE;
    this.messages = this.messages.filter((message) => {
      if (Date.parse(message.createdAt) > cutoff) return true;
      clearTimeout(this.timers.get(message.id));
      this.timers.delete(message.id);
      return false;
    });
    while (this.messages.length > MAX_MESSAGES) {
      const removed = this.messages.shift()!;
      clearTimeout(this.timers.get(removed.id));
      this.timers.delete(removed.id);
    }
    this.onChange(this.snapshot());
  }
}

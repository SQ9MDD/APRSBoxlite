import net from 'node:net';

const FEND = 0xc0;
const FESC = 0xdb;
const TFEND = 0xdc;
const TFESC = 0xdd;
const HISTORY_MAXIMUM = 1_000;
const HISTORY_AGE_MS = 60 * 60 * 1_000;
const FRAME_BUFFER_MAXIMUM = 8_192;

export interface KissTcpInterface {
  id: string;
  name: string;
  type: 'kiss-tcp' | 'kiss-serial';
  enabled: boolean;
  hostPort: string;
}

export interface TrafficFrame {
  id: string;
  receivedAt: string;
  interfaceId: string;
  interfaceName: string;
  packet: string;
  source: 'kiss';
}

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export function decodeAx25ToTnc2(payload: Uint8Array): string | undefined {
  if (payload.length < 16) return undefined;
  const addresses: Array<{ callsign: string; repeated: boolean }> = [];
  let offset = 0;
  while (offset + 7 <= payload.length) {
    const chunk = payload.subarray(offset, offset + 7);
    const callsign = String.fromCharCode(
      ...Array.from(chunk.subarray(0, 6), (value) => value >> 1),
    ).trimEnd();
    if (!callsign) return undefined;
    const ssid = (chunk[6] >> 1) & 0x0f;
    addresses.push({
      callsign: ssid ? `${callsign}-${ssid}` : callsign,
      repeated: (chunk[6] & 0x80) !== 0,
    });
    offset += 7;
    if ((chunk[6] & 0x01) !== 0) break;
  }
  if (addresses.length < 2 || offset + 2 > payload.length) return undefined;
  if (payload[offset] !== 0x03 || payload[offset + 1] !== 0xf0)
    return undefined;
  const destination = addresses[0].callsign;
  const source = addresses[1].callsign;
  const via = addresses
    .slice(2)
    .map((address) => `${address.callsign}${address.repeated ? '*' : ''}`)
    .join(',');
  const header = via
    ? `${source}>${destination},${via}`
    : `${source}>${destination}`;
  return `${header}:${Buffer.from(payload.subarray(offset + 2)).toString('utf8')}`;
}

export class KissFrameDecoder {
  private buffer = Buffer.alloc(0);

  consume(chunk: Uint8Array): string[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const frames: string[] = [];
    while (true) {
      const start = this.buffer.indexOf(FEND);
      if (start === -1) {
        if (this.buffer.length > FRAME_BUFFER_MAXIMUM)
          this.buffer = Buffer.alloc(0);
        return frames;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      const end = this.buffer.indexOf(FEND, 1);
      if (end === -1) {
        if (this.buffer.length > FRAME_BUFFER_MAXIMUM)
          this.buffer = Buffer.alloc(0);
        return frames;
      }
      const rawFrame = this.buffer.subarray(1, end);
      this.buffer = this.buffer.subarray(end);
      if (rawFrame.length < 2 || (rawFrame[0] & 0x0f) !== 0) continue;
      const decoded = decodeAx25ToTnc2(unescapeKiss(rawFrame.subarray(1)));
      if (decoded) frames.push(decoded);
    }
  }
}

function unescapeKiss(payload: Uint8Array): Buffer {
  const output: number[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    if (payload[index] === FESC && index + 1 < payload.length) {
      if (payload[index + 1] === TFEND) {
        output.push(FEND);
        index += 1;
        continue;
      }
      if (payload[index + 1] === TFESC) {
        output.push(FESC);
        index += 1;
        continue;
      }
    }
    output.push(payload[index]);
  }
  return Buffer.from(output);
}

export class KissTcpRxService {
  private readonly sockets = new Map<string, net.Socket>();
  private readonly statuses = new Map<string, ConnectionStatus>();
  private readonly configuredEndpoints = new Map<string, string>();
  private history: TrafficFrame[] = [];
  private readonly onFrame: (frame: TrafficFrame) => void;
  private readonly onStatus: (
    interfaceId: string,
    status: ConnectionStatus,
  ) => void;

  constructor(
    onFrame: (frame: TrafficFrame) => void,
    onStatus: (interfaceId: string, status: ConnectionStatus) => void,
  ) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
  }

  configure(interfaces: KissTcpInterface[]): void {
    const targets = new Map(
      interfaces
        .filter((item) => item.enabled && item.type === 'kiss-tcp')
        .map((item) => [item.id, item]),
    );
    for (const [id, socket] of this.sockets) {
      if (!targets.has(id)) {
        socket.destroy();
        this.sockets.delete(id);
        this.configuredEndpoints.delete(id);
        this.setStatus(id, 'disconnected');
      }
    }
    for (const target of targets.values()) {
      if (
        this.sockets.has(target.id) &&
        this.configuredEndpoints.get(target.id) !== target.hostPort
      ) {
        this.sockets.get(target.id)?.destroy();
        this.sockets.delete(target.id);
        this.setStatus(target.id, 'disconnected');
      }
      if (!this.sockets.has(target.id)) this.connect(target);
    }
  }

  getHistory(): TrafficFrame[] {
    this.pruneHistory();
    return [...this.history];
  }

  getStatuses(): Record<string, ConnectionStatus> {
    return Object.fromEntries(this.statuses);
  }

  stop(): void {
    for (const socket of this.sockets.values()) socket.destroy();
    this.sockets.clear();
    this.configuredEndpoints.clear();
  }

  private connect(configuration: KissTcpInterface): void {
    const endpoint = parseHostPort(configuration.hostPort);
    if (!endpoint) {
      this.setStatus(configuration.id, 'error');
      return;
    }
    const decoder = new KissFrameDecoder();
    const socket = net.createConnection(endpoint);
    this.sockets.set(configuration.id, socket);
    this.configuredEndpoints.set(configuration.id, configuration.hostPort);
    this.setStatus(configuration.id, 'connecting');
    socket.on('connect', () => this.setStatus(configuration.id, 'connected'));
    socket.on('data', (chunk: Buffer) => {
      for (const packet of decoder.consume(chunk)) {
        const frame: TrafficFrame = {
          id: crypto.randomUUID(),
          receivedAt: new Date().toISOString(),
          interfaceId: configuration.id,
          interfaceName: configuration.name || configuration.hostPort,
          packet,
          source: 'kiss',
        };
        this.addFrame(frame);
      }
    });
    socket.on('error', () => this.setStatus(configuration.id, 'error'));
    socket.on('close', () => {
      if (this.sockets.get(configuration.id) === socket) {
        this.sockets.delete(configuration.id);
        this.configuredEndpoints.delete(configuration.id);
        if (this.statuses.get(configuration.id) !== 'error') {
          this.setStatus(configuration.id, 'disconnected');
        }
      }
    });
  }

  private addFrame(frame: TrafficFrame): void {
    this.history.unshift(frame);
    this.pruneHistory();
    this.onFrame(frame);
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - HISTORY_AGE_MS;
    this.history = this.history
      .filter((frame) => Date.parse(frame.receivedAt) >= cutoff)
      .slice(0, HISTORY_MAXIMUM);
  }

  private setStatus(interfaceId: string, status: ConnectionStatus): void {
    if (this.statuses.get(interfaceId) === status) return;
    this.statuses.set(interfaceId, status);
    this.onStatus(interfaceId, status);
  }
}

function parseHostPort(value: string): net.NetConnectOpts | undefined {
  const match = value.trim().match(/^([^:\s]+):(\d{1,5})$/);
  if (!match) return undefined;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  return { host: match[1], port };
}

import { SerialPort } from 'serialport';
import { KissFrameDecoder } from './kissTcpRx';
import type { ConnectionStatus, TrafficFrame } from './kissTcpRx';

export interface KissSerialInterface {
  id: string;
  name: string;
  type: 'kiss-tcp' | 'kiss-serial';
  enabled: boolean;
  txBlocked?: boolean;
  serialDevice: string;
  baudRate: string;
  reconnectTimeout?: string;
}

type Port = Pick<SerialPort, 'isOpen' | 'opening' | 'on' | 'open' | 'close' | 'write' | 'drain'>;
type PortFactory = (path: string, baudRate: number) => Port;
const BAUD_RATES = new Set([1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]);
const MAX_AGE = 60 * 60 * 1000;

export class KissSerialRxService {
  private readonly configurations = new Map<string, KissSerialInterface>();
  private readonly ports = new Map<string, Port>();
  private readonly endpoints = new Map<string, string>();
  private readonly closing = new Set<string>();
  private readonly statuses = new Map<string, ConnectionStatus>();
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>();
  private history: TrafficFrame[] = [];
  private readonly onFrame: (frame: TrafficFrame) => void;
  private readonly onStatus: (id: string, status: ConnectionStatus) => void;
  private readonly createPort: PortFactory;

  constructor(onFrame: (frame: TrafficFrame) => void, onStatus: (id: string, status: ConnectionStatus) => void, createPort: PortFactory = (device, baudRate) => new SerialPort({ path: device, baudRate, dataBits: 8, stopBits: 1, parity: 'none', rtscts: false, autoOpen: false })) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.createPort = createPort;
  }

  configure(interfaces: KissSerialInterface[]): void {
    const desired = new Map(interfaces.filter((item) => item.type === 'kiss-serial').map((item) => [item.id, item]));
    this.configurations.clear();
    for (const [id, config] of desired) this.configurations.set(id, config);
    for (const [id, timer] of this.retries) {
      clearTimeout(timer);
      this.retries.delete(id);
    }
    for (const [id] of this.ports) {
      const current = desired.get(id);
      if (!current?.enabled || this.endpoints.get(id) !== `${current.serialDevice}:${current.baudRate}`) this.disconnect(id);
    }
    for (const config of desired.values()) {
      if (!config.enabled) this.setStatus(config.id, 'disconnected');
      else if (!this.ports.has(config.id) && !this.closing.has(config.id)) this.connect(config);
    }
  }

  isConfigured(id: string): boolean { return this.configurations.has(id); }
  getStatuses(): Record<string, ConnectionStatus> {
    return Object.fromEntries([...this.statuses].filter(([id]) => this.configurations.has(id)));
  }
  getHistory(): TrafficFrame[] {
    this.history = this.history.filter((item) => Date.parse(item.receivedAt) >= Date.now() - MAX_AGE).slice(0, 1000);
    return [...this.history];
  }

  async transmit(id: string, frame: Uint8Array): Promise<void> {
    const config = this.configurations.get(id);
    const port = this.ports.get(id);
    if (!config?.enabled || config.txBlocked) throw new Error('TX is blocked or the interface is disabled.');
    if (!port?.isOpen || this.statuses.get(id) !== 'connected') throw new Error('The selected KISS Serial interface is not connected.');
    await new Promise<void>((resolve, reject) => port.write(Buffer.from(frame), (error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => port.drain((error) => error ? reject(error) : resolve()));
    const packet = new KissFrameDecoder().consume(frame)[0];
    if (packet) this.addFrame(config, packet, 'tx');
  }

  reconnectAfterResume(): void {
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
    for (const id of [...this.ports.keys()]) this.disconnect(id);
    for (const config of this.configurations.values()) if (config.enabled && !this.ports.has(config.id) && !this.closing.has(config.id)) this.connect(config);
  }

  stop(): void {
    this.configurations.clear();
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
    for (const id of [...this.ports.keys()]) this.disconnect(id);
  }

  private disconnect(id: string): void {
    const port = this.ports.get(id);
    if (!port) return;
    this.ports.delete(id);
    this.endpoints.delete(id);
    this.closing.add(id);
    this.setStatus(id, 'disconnected');
    const finish = () => {
      if (!this.closing.delete(id)) return;
      const config = this.configurations.get(id);
      if (config?.enabled && !this.ports.has(id)) this.connect(config);
    };
    if (port.isOpen) port.close(() => finish());
    else if (!port.opening) finish();
    // An opening port is closed by its open callback before reconnecting.
  }

  private connect(config: KissSerialInterface): void {
    const device = config.serialDevice.trim();
    const baud = Number(config.baudRate);
    if (!device || !BAUD_RATES.has(baud)) { this.setStatus(config.id, 'error'); return; }
    let port: Port;
    try { port = this.createPort(device, baud); }
    catch { this.setStatus(config.id, 'error'); this.scheduleRetry(config.id); return; }
    const decoder = new KissFrameDecoder();
    this.ports.set(config.id, port);
    this.endpoints.set(config.id, `${config.serialDevice}:${config.baudRate}`);
    this.setStatus(config.id, 'connecting');
    port.on('data', (chunk: Buffer) => {
      if (this.ports.get(config.id) !== port) return;
      for (const packet of decoder.consume(chunk)) this.addFrame(this.configurations.get(config.id) ?? config, packet, 'rx');
    });
    port.on('error', () => {
      if (this.ports.get(config.id) !== port) return;
      this.setStatus(config.id, 'error');
      if (port.isOpen) port.close(() => undefined);
    });
    port.on('close', () => {
      if (this.ports.get(config.id) !== port) return;
      this.ports.delete(config.id);
      this.endpoints.delete(config.id);
      if (this.statuses.get(config.id) !== 'error') this.setStatus(config.id, 'disconnected');
      this.scheduleRetry(config.id);
    });
    port.open((error) => {
      if (this.ports.get(config.id) !== port) {
        const finish = () => {
          this.closing.delete(config.id);
          const next = this.configurations.get(config.id);
          if (next?.enabled && !this.ports.has(config.id)) this.connect(next);
        };
        if (port.isOpen) port.close(() => finish()); else finish();
        return;
      }
      if (error) {
        this.ports.delete(config.id);
        this.endpoints.delete(config.id);
        this.setStatus(config.id, 'error');
        this.scheduleRetry(config.id);
      } else this.setStatus(config.id, 'connected');
    });
  }

  private scheduleRetry(id: string): void {
    const config = this.configurations.get(id);
    if (!config?.enabled || this.retries.has(id)) return;
    const seconds = Number(config.reconnectTimeout);
    const delay = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : 5000;
    const timer = setTimeout(() => {
      this.retries.delete(id);
      const next = this.configurations.get(id);
      if (next?.enabled && !this.ports.has(id) && !this.closing.has(id)) this.connect(next);
    }, delay);
    timer.unref();
    this.retries.set(id, timer);
  }

  private addFrame(config: KissSerialInterface, packet: string, direction: 'rx' | 'tx'): void {
    const frame: TrafficFrame = { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), interfaceId: config.id, interfaceName: config.name || config.serialDevice, packet, source: 'kiss', direction };
    this.history.unshift(frame);
    this.getHistory();
    this.onFrame(frame);
  }
  private setStatus(id: string, status: ConnectionStatus): void {
    if (this.statuses.get(id) !== status) { this.statuses.set(id, status); this.onStatus(id, status); }
  }
}

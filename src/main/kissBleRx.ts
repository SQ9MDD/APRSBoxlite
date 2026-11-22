import { KissFrameDecoder } from './kissTcpRx';
import type { ConnectionStatus, TrafficFrame } from './kissTcpRx';

type Interface = { id: string; name: string; type: string; enabled: boolean; txBlocked: boolean };

export class KissBleRxService {
  private configs = new Map<string, Interface>();
  private decoders = new Map<string, KissFrameDecoder>();
  private statuses = new Map<string, ConnectionStatus>();
  private history: TrafficFrame[] = [];
  private onFrame: (frame: TrafficFrame) => void;
  private onStatus: (id: string, status: ConnectionStatus) => void;
  private write: (id: string, bytes: Uint8Array) => Promise<void>;
  constructor(onFrame: (frame: TrafficFrame) => void, onStatus: (id: string, status: ConnectionStatus) => void, write: (id: string, bytes: Uint8Array) => Promise<void>) {
    this.onFrame = onFrame; this.onStatus = onStatus; this.write = write;
  }
  configure(interfaces: Interface[]): void {
    this.configs = new Map(interfaces.filter((item) => item.type === 'kiss-ble').map((item) => [item.id, item]));
    for (const id of this.statuses.keys()) if (!this.configs.get(id)?.enabled) { this.statuses.delete(id); this.decoders.delete(id); }
    for (const config of this.configs.values()) if (!this.statuses.has(config.id)) this.statuses.set(config.id, 'disconnected');
  }
  status(id: string, status: ConnectionStatus): void {
    if (!this.configs.get(id)?.enabled) return;
    if (status !== 'connected') this.decoders.delete(id);
    if (this.statuses.get(id) !== status) { this.statuses.set(id, status); this.onStatus(id, status); }
  }
  receive(id: string, bytes: Uint8Array): void {
    const config = this.configs.get(id);
    if (!config?.enabled || this.statuses.get(id) !== 'connected' || !bytes.length || bytes.length > 4096) return;
    let decoder = this.decoders.get(id);
    if (!decoder) { decoder = new KissFrameDecoder(); this.decoders.set(id, decoder); }
    for (const packet of decoder.consume(bytes)) {
      const frame: TrafficFrame = { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), interfaceId: id, interfaceName: config.name || 'KISS Bluetooth LE', packet, source: 'kiss', direction: 'rx' };
      this.history.unshift(frame); this.getHistory(); this.onFrame(frame);
    }
  }
  isConfigured(id: string): boolean { return this.configs.has(id); }
  async transmit(id: string, bytes: Uint8Array): Promise<void> {
    const config = this.configs.get(id);
    if (!config?.enabled || config.txBlocked) throw new Error('TX is blocked or the interface is disabled.');
    if (this.statuses.get(id) !== 'connected') throw new Error('The selected Bluetooth interface is not connected.');
    if (!bytes.length || bytes.length > 1024) throw new Error('Invalid KISS frame length.');
    await this.write(id, bytes);
    const packet = new KissFrameDecoder().consume(bytes)[0];
    if (packet) {
      const frame: TrafficFrame = { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), interfaceId: id, interfaceName: config.name || 'KISS Bluetooth LE', packet, source: 'kiss', direction: 'tx' };
      this.history.unshift(frame); this.getHistory(); this.onFrame(frame);
    }
  }
  getStatuses(): Record<string, ConnectionStatus> { return Object.fromEntries(this.statuses); }
  getHistory(): TrafficFrame[] {
    this.history = this.history.filter((item) => Date.parse(item.receivedAt) >= Date.now() - 3600000).slice(0, 1000);
    return [...this.history];
  }
}

import { defaultAprsIsFilter, validAprsIsFilter } from '../aprsIsFilter';
import net from 'node:net';
import { isUtf8 } from 'node:buffer';
import { KissFrameDecoder } from './kissTcpRx';
import type { ConnectionStatus, TrafficFrame } from './kissTcpRx';

export interface AprsIsInterface {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  aprsIsServer?: string;
  aprsIsRadius?: string;
  aprsIsFilter?: string;
  aprsIsPasscode?: string;
  aprsIsIgateRfToIs?: boolean;
  txBlocked?: boolean;
  reconnectTimeout?: string;
}
type Station = { callsign?: unknown; ssid?: unknown; location?: unknown };
type Target = { id: string; name: string; host: string; port: number; login: string; passcode: string; txBlocked: boolean; igateRfToIs: boolean; filter: string; reconnectTimeout?: string };
const MAX_LINE = 4096;
function interfaceLabel(name: string): string {
  return name && name.toUpperCase() !== 'APRS-IS' ? `APRS-IS · ${name}` : 'APRS-IS';
}

export function aprsIsPasscode(callsign: string): string {
  let value = 0x73e2;
  for (const [index, char] of [...callsign.toUpperCase().split('-')[0]].entries()) value ^= char.charCodeAt(0) << (index % 2 ? 0 : 8);
  return String(value & 0x7fff);
}

export function makeAprsIsTarget(item: AprsIsInterface, station: Station | undefined): Target | undefined {
  const server = (item.aprsIsServer || 'rotate.aprs2.net:14580').trim().match(/^([^\s:]+):(\d{1,5})$/);
  const port = Number(server?.[2]);
  const call = typeof station?.callsign === 'string' ? station.callsign.trim().toUpperCase() : '';
  const ssid = typeof station?.ssid === 'string' ? station.ssid : '';
  const filter = item.aprsIsFilter === undefined ? defaultAprsIsFilter(station?.location, item.aprsIsRadius || '25') : item.aprsIsFilter.trim();
  const passcode = item.aprsIsPasscode?.trim() || aprsIsPasscode(call);
  if (!server || port < 1 || port > 65535 || !/^[A-Z0-9]{1,6}$/.test(call) || !/^-(?:[0-9]|1[0-5])$/.test(ssid) || !/^(?:-1|\d{1,5})$/.test(passcode) || filter === undefined || !validAprsIsFilter(filter)) return undefined;
  return { id: item.id, name: item.name, host: server[1], port, login: `${call}${ssid === '-0' ? '' : ssid}`, passcode, txBlocked: !!item.txBlocked, igateRfToIs: !!item.aprsIsIgateRfToIs, filter, reconnectTimeout: item.reconnectTimeout };
}

function parseRfPacket(raw: string): { header: string; info: string; key: string } | undefined {
  const parse = (value: string) => {
    const match = value.match(/^([A-Z0-9]{1,6}(?:-(?:[0-9]|1[0-5]))?)>([A-Z0-9]{1,6}(?:-(?:[0-9]|1[0-5]))?)((?:,[A-Z0-9]{1,6}(?:-(?:[0-9]|1[0-5]))?\*?)*)[:]([^\r\n]*)$/i);
    if (!match || !match[4] || match[4].startsWith('?') || match[4].includes('\uFFFD')) return undefined;
    const paths = match[3].split(',').filter(Boolean);
    if (paths.some((path) => /^(?:TCPIP|TCPXX)/i.test(path) || /^(?:NOGATE|RFONLY|I)(?:-(?:[0-9]|1[0-5]))?\*?$/i.test(path) || /^q[a-z]{2}\*?$/i.test(path))) return undefined;
    return { header: `${match[1]}>${match[2]}${match[3]}`, info: match[4], key: `${match[1].toUpperCase()}>${match[2].toUpperCase()}:${match[4]}` };
  };
  const outer = parse(raw.replace(/[\r\n]+$/, ''));
  if (!outer) return undefined;
  if (!outer.info.startsWith('}')) return outer;
  const inner = parse(outer.info.slice(1));
  if (!inner || inner.info.startsWith('}')) return undefined;
  const outerAddress = outer.header.replace('>', ',').split(',');
  return { ...inner, header: [inner.header, outerAddress[0], ...outerAddress.slice(2)].join(',') };
}

export class AprsIsRxService {
  private targets = new Map<string, Target>();
  private sockets = new Map<string, net.Socket>();
  private signatures = new Map<string, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private statuses = new Map<string, ConnectionStatus>();
  private verified = new Set<string>();
  private history: TrafficFrame[] = [];
  private gatedPackets = new Map<string, Map<string, number>>();
  private pendingRfWrites = new Map<string, ReturnType<typeof setTimeout>>();
  private configuredIds = new Set<string>();
  private onFrame: (frame: TrafficFrame) => void;
  private onStatus: (id: string, status: ConnectionStatus) => void;
  private version: string;
  private createConnection: (endpoint: net.NetConnectOpts) => net.Socket;
  constructor(onFrame: (frame: TrafficFrame) => void, onStatus: (id: string, status: ConnectionStatus) => void, version: string, createConnection: (endpoint: net.NetConnectOpts) => net.Socket = (endpoint) => net.createConnection(endpoint)) {
    this.onFrame = onFrame; this.onStatus = onStatus; this.version = version; this.createConnection = createConnection;
  }

  configure(interfaces: AprsIsInterface[], station: Station | undefined): void {
    const configured = interfaces.filter((item) => item.type === 'aprs-is');
    this.configuredIds = new Set(configured.map((item) => item.id));
    const next = new Map<string, Target>();
    for (const item of configured) {
      if (!item.enabled) continue;
      const target = makeAprsIsTarget(item, station);
      if (target) next.set(item.id, target);
    }
    this.targets = next;
    for (const [id, timer] of this.timers) { clearTimeout(timer); this.timers.delete(id); }
    for (const [id, socket] of this.sockets) {
      const target = next.get(id);
      if (!target || this.signatures.get(id) !== this.signature(target)) {
        this.clearPendingRfWrite(id);
        this.sockets.delete(id); this.signatures.delete(id); this.verified.delete(id); socket.destroy(); this.setStatus(id, 'disconnected');
      }
    }
    for (const item of configured) {
      if (!item.enabled) this.setStatus(item.id, 'disconnected');
      else if (!next.has(item.id)) this.setStatus(item.id, 'error');
    }
    for (const target of next.values()) if (!this.sockets.has(target.id)) this.connect(target);
  }
  getStatuses(): Record<string, ConnectionStatus> { return Object.fromEntries([...this.statuses].filter(([id]) => this.configuredIds.has(id))); }
  isConfigured(id: string): boolean { return this.configuredIds.has(id); }
  canTransmit(id: string): boolean { return this.targets.has(id) && !this.targets.get(id)?.txBlocked && this.verified.has(id) && this.statuses.get(id) === 'connected'; }
  forwardRf(frame: TrafficFrame): void {
    if (frame.source !== 'kiss' || frame.direction !== 'rx') return;
    const now = Date.now();
    const receivedAt = Date.parse(frame.receivedAt);
    if (!Number.isFinite(receivedAt) || receivedAt > now || now - receivedAt >= 60000) return;
    const packet = parseRfPacket(frame.packet);
    if (!packet) return;
    for (const target of this.targets.values()) {
      if (!target.igateRfToIs || !this.canTransmit(target.id)) continue;
      const socket = this.sockets.get(target.id);
      if (!socket || socket.destroyed || (socket.writableLength ?? 0) !== 0 || this.pendingRfWrites.has(target.id)) continue;
      const line = `${packet.header},qAO,${target.login}:${packet.info}`;
      if (Buffer.byteLength(line, 'utf8') + 2 > 512) continue;
      let recent = this.gatedPackets.get(target.id);
      if (!recent) { recent = new Map(); this.gatedPackets.set(target.id, recent); }
      for (const [key, time] of recent) if (now - time >= 30000) recent.delete(key);
      if (recent.has(packet.key)) continue;
      if (recent.size >= 1000) recent.delete(recent.keys().next().value!);
      recent.set(packet.key, now);
      const dedup = recent;
      const timer = setTimeout(() => {
        if (this.pendingRfWrites.get(target.id) !== timer) return;
        this.pendingRfWrites.delete(target.id);
        if (dedup.get(packet.key) === now) dedup.delete(packet.key);
        if (this.sockets.get(target.id) === socket) socket.destroy();
      }, Math.max(1, 60000 - (Date.now() - receivedAt)));
      timer.unref();
      this.pendingRfWrites.set(target.id, timer);
      try {
        socket.write(`${line}\r\n`, (error) => {
          if (this.pendingRfWrites.get(target.id) !== timer) return;
          clearTimeout(timer); this.pendingRfWrites.delete(target.id);
          if (error) { if (dedup.get(packet.key) === now) dedup.delete(packet.key); return; }
          const sent: TrafficFrame = { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), interfaceId: target.id, interfaceName: interfaceLabel(target.name), packet: line, source: 'aprs-is', direction: 'tx' };
          this.history.unshift(sent); this.getHistory(); this.onFrame(sent);
        });
      } catch { clearTimeout(timer); this.pendingRfWrites.delete(target.id); if (dedup.get(packet.key) === now) dedup.delete(packet.key); }
    }
  }
  async transmit(id: string, frame: Uint8Array): Promise<void> {
    const target = this.targets.get(id);
    if (!target || target.txBlocked) throw new Error('TX is blocked or the APRS-IS interface is disabled.');
    const socket = this.sockets.get(id);
    if (!socket || socket.destroyed || this.statuses.get(id) !== 'connected') throw new Error('The APRS-IS interface is not connected.');
    if (!this.verified.has(id)) throw new Error('APRS-IS login is not verified; check the callsign and passcode.');
    const packet = new KissFrameDecoder().consume(frame)[0];
    const match = packet?.match(/^([^>]+)>([^,:]+)(?:,[^:]*)?:(.*)$/s);
    if (!match || match[1].toUpperCase().replace(/-0$/, '') !== target.login || match[3].startsWith('}') || /[\r\n]/.test(match[3])) throw new Error('Invalid local APRS-IS packet.');
    const line = `${target.login}>${match[2]},TCPIP*:${match[3]}`;
    if (Buffer.byteLength(line, 'utf8') + 2 > 512) throw new Error('APRS-IS packet is too long.');
    await new Promise<void>((resolve, reject) => socket.write(`${line}\r\n`, (error) => error ? reject(error) : resolve()));
    this.history.unshift({ id: crypto.randomUUID(), receivedAt: new Date().toISOString(), interfaceId: id, interfaceName: interfaceLabel(target.name), packet: line, source: 'aprs-is', direction: 'tx' });
    const [sent] = this.getHistory(); if (sent) this.onFrame(sent);
  }
  getHistory(): TrafficFrame[] {
    this.history = this.history.filter((frame) => Date.parse(frame.receivedAt) >= Date.now() - 3600000).slice(0, 1000);
    return [...this.history];
  }
  reconnectAfterResume(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const timer of this.pendingRfWrites.values()) clearTimeout(timer);
    this.pendingRfWrites.clear();
    for (const socket of this.sockets.values()) socket.destroy();
    this.sockets.clear(); this.signatures.clear(); this.verified.clear();
    for (const target of this.targets.values()) this.connect(target);
  }
  stop(): void {
    this.targets.clear();
    this.gatedPackets.clear();
    for (const timer of this.pendingRfWrites.values()) clearTimeout(timer);
    this.pendingRfWrites.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const socket of this.sockets.values()) socket.destroy();
    this.sockets.clear(); this.signatures.clear(); this.verified.clear();
  }
  private clearPendingRfWrite(id: string): void {
    const timer = this.pendingRfWrites.get(id);
    if (timer) { clearTimeout(timer); this.pendingRfWrites.delete(id); }
  }
  private signature(target: Target): string { return JSON.stringify([target.host, target.port, target.login, target.passcode, target.filter]); }
  private connect(target: Target): void {
    const socket = this.createConnection({ host: target.host, port: target.port });
    let buffer = Buffer.alloc(0);
    this.sockets.set(target.id, socket); this.signatures.set(target.id, this.signature(target));
    this.setStatus(target.id, 'connecting');
    socket.setTimeout(15000); socket.setKeepAlive(true); socket.setNoDelay(true);
    socket.on('timeout', () => socket.destroy());
    socket.on('connect', () => {
      if (this.sockets.get(target.id) !== socket) return;
      socket.write(`user ${target.login} pass ${target.passcode} vers APRSBoxLite ${this.version.replace(/\s/g, '')}${target.filter ? ` filter ${target.filter}` : ''}\r\n`);
    });
    socket.on('data', (chunk: Buffer) => {
      if (this.sockets.get(target.id) !== socket) return;
      buffer = Buffer.concat([buffer, chunk]);
      let newline: number;
      while ((newline = buffer.indexOf(0x0a)) !== -1) {
        let raw = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
        if (raw.at(-1) === 0x0d) raw = raw.subarray(0, -1);
        const line = raw.toString(isUtf8(raw) ? 'utf8' : 'latin1');
        if (/^(?:#\s*)?logresp\s+/i.test(line)) {
          const match = line.match(/^(?:#\s*)?logresp\s+(\S+)\s+(verified|unverified)\b/i);
          if (match?.[1].toUpperCase() === target.login && match[2].toLowerCase() === 'verified') this.verified.add(target.id);
          else this.verified.delete(target.id);
          if (match?.[1].toUpperCase() === target.login) { socket.setTimeout(0); this.setStatus(target.id, 'connected'); }
          continue;
        }
        if (line.length > MAX_LINE || line.startsWith('#') || !/^[A-Za-z0-9]{1,9}(?:-[A-Za-z0-9]{1,9})?>[^\s:]+:[^\r\n]*$/.test(line)) continue;
        const current = this.targets.get(target.id);
        if (!current) return;
        const frame: TrafficFrame = { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), interfaceId: target.id, interfaceName: interfaceLabel(current.name), packet: line, source: 'aprs-is', direction: 'rx' };
        this.history.unshift(frame); this.getHistory(); this.onFrame(frame);
      }
      if (buffer.length > MAX_LINE) socket.destroy();
    });
    socket.on('error', () => { if (this.sockets.get(target.id) === socket) this.setStatus(target.id, 'error'); });
    socket.on('close', () => {
      if (this.sockets.get(target.id) !== socket) return;
      this.sockets.delete(target.id); this.signatures.delete(target.id); this.verified.delete(target.id);
      this.clearPendingRfWrite(target.id);
      if (this.statuses.get(target.id) !== 'error') this.setStatus(target.id, 'disconnected');
      const current = this.targets.get(target.id);
      if (!current) return;
      const seconds = Number(current.reconnectTimeout);
      const timer = setTimeout(() => { this.timers.delete(target.id); const next = this.targets.get(target.id); if (next && !this.sockets.has(target.id)) this.connect(next); }, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : 5000);
      timer.unref(); this.timers.set(target.id, timer);
    });
  }
  private setStatus(id: string, status: ConnectionStatus): void {
    if (this.statuses.get(id) !== status) { this.statuses.set(id, status); this.onStatus(id, status); }
  }
}

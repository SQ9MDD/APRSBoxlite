// Web Bluetooth is available in Electron's renderer; KISS decoding stays in main.
type Characteristic = EventTarget & { value?: DataView; startNotifications(): Promise<Characteristic>; writeValueWithoutResponse(value: Uint8Array): Promise<void> };
type Device = EventTarget & { name?: string; gatt?: { connected: boolean; connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }> }>; disconnect(): void } };
type Bluetooth = { requestDevice(options: object): Promise<Device>; getAvailability?(): Promise<boolean> };
const profiles = { 'rt-950-pro': { service: '0000ffe0-0000-1000-8000-00805f9b34fb', notify: '0000ffe1-0000-1000-8000-00805f9b34fb' } };
type Link = { device: Device; timer?: ReturnType<typeof setTimeout>; stopped: boolean; delay: number; report: (message: string) => void; characteristic?: Characteristic; writeQueue: Promise<void>; pendingWrites: number };
const links = new Map<string, Link>();
const transmitAllowed = new Set<string>();
const listeners = new WeakMap<Device, { characteristic: Characteristic; handler: EventListener }>();
let scanning: string | undefined;
let cancelScan: ((reason?: string) => void) | undefined;
let scanHasDevices = false;

export function noteBleDevices(found: boolean): void { if (scanning && found) scanHasDevices = true; }
export function isBleScanning(id: string): boolean { return scanning === id; }
export function isAnyBleScanning(): boolean { return scanning !== undefined; }
export function hasBleLink(id: string): boolean { return links.has(id); }

export function scanBle(id: string, seconds: string, report: (message: string) => void, automatic = false): void {
  if (scanning) throw new Error('A Bluetooth scan is already running. Cancel it before starting another.');
  const bluetooth = (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
  if (!bluetooth) throw new Error('Web Bluetooth is not available on this platform.');
  scanning = id;
  scanHasDevices = false;
  let cancelled = false;
  let finished = false;
  const timer = setTimeout(() => {
    if (scanHasDevices && !automatic) report('Select a device to connect.');
    else cancelScan?.('Scan timed out. Check Bluetooth permissions, then scan again.');
  }, 30_000);
  cancelScan = (reason = 'Scan cancelled.') => {
    if (finished || cancelled) return;
    cancelled = true;
    clearTimeout(timer);
    report(reason);
    window.aprsbox.ble.choose('');
  };
  window.aprsbox.ble.begin();
  window.aprsbox.ble.status(id, 'connecting');
  report('Scanning for Bluetooth devices…');
  void bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [profiles['rt-950-pro'].service] }).then((device) => {
    finished = true; clearTimeout(timer); cancelScan = undefined;
    scanning = undefined;
    if (cancelled) { window.aprsbox.ble.status(id, 'disconnected'); return; }
    report(`Selected ${device.name || 'Bluetooth device'}. Connecting…`);
    disconnectBle(id);
    const link: Link = { device, stopped: false, delay: Math.max(1, Math.min(Number(seconds) || 5, 3600)) * 1000, report, writeQueue: Promise.resolve(), pendingWrites: 0 };
    links.set(id, link);
    device.addEventListener('gattserverdisconnected', () => {
      if (link.stopped || links.get(id) !== link) return;
      link.characteristic = undefined;
      link.report('Bluetooth disconnected. Reconnecting…');
      window.aprsbox.ble.status(id, 'disconnected');
      schedule(id, link);
    });
    void connect(id, link);
  }).catch((error: unknown) => {
    finished = true; clearTimeout(timer); cancelScan = undefined; scanning = undefined;
    if (!cancelled) report(`Bluetooth scan failed: ${error instanceof Error ? error.message : String(error)}`);
    window.aprsbox.ble.status(id, 'disconnected');
  });
  if (bluetooth.getAvailability) void bluetooth.getAvailability().then((available) => {
    if (!available && !finished) cancelScan?.('Bluetooth is unavailable. Turn it on and allow APRSBOX access in system settings.');
  }).catch(() => undefined);
}
export function cancelBleScan(): void { cancelScan?.(); }
function schedule(id: string, link: Link): void {
  if (!link.stopped && !link.timer) link.timer = setTimeout(() => { link.timer = undefined; void connect(id, link); }, link.delay);
}
async function connect(id: string, link: Link): Promise<void> {
  if (link.stopped) return;
  window.aprsbox.ble.status(id, 'connecting');
  try {
    if (!link.device.gatt) throw new Error('GATT unavailable');
    const server = await link.device.gatt.connect();
    const service = await server.getPrimaryService(profiles['rt-950-pro'].service);
    const characteristic = await service.getCharacteristic(profiles['rt-950-pro'].notify);
    const previous = listeners.get(link.device);
    if (previous) previous.characteristic.removeEventListener('characteristicvaluechanged', previous.handler);
    const handler: EventListener = (event) => {
      if (link.stopped || links.get(id) !== link) return;
      const value = (event.target as Characteristic).value;
      if (value) window.aprsbox.ble.receive(id, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    };
    characteristic.addEventListener('characteristicvaluechanged', handler);
    listeners.set(link.device, { characteristic, handler });
    await characteristic.startNotifications();
    if (link.stopped || links.get(id) !== link) { link.device.gatt.disconnect(); return; }
    link.characteristic = characteristic;
    link.report(`Connected to ${link.device.name || 'Bluetooth device'}.`);
    window.aprsbox.ble.status(id, 'connected');
  } catch (error) {
    if (!link.stopped) { link.report(`Bluetooth connection failed: ${error instanceof Error ? error.message : String(error)}. Retrying…`); window.aprsbox.ble.status(id, 'error'); link.device.gatt?.disconnect(); schedule(id, link); }
  }
}
export function disconnectBle(id: string): void {
  if (scanning === id) cancelBleScan();
  const link = links.get(id);
  if (!link) return;
  link.stopped = true; clearTimeout(link.timer); links.delete(id); link.device.gatt?.disconnect();
  link.report('Bluetooth disconnected.');
  const previous = listeners.get(link.device);
  if (previous) previous.characteristic.removeEventListener('characteristicvaluechanged', previous.handler);
  listeners.delete(link.device);
  window.aprsbox.ble.status(id, 'disconnected');
}
export function cancelPendingBleTransmissions(): void {
  // A timed-out GATT write may still be awaiting the OS. Disconnect that link
  // so its remaining chunks and queued frames cannot reach the next identity.
  for (const [id, link] of links) if (link.pendingWrites) disconnectBle(id);
}
export async function transmitBle(id: string, bytes: Uint8Array): Promise<void> {
  const link = links.get(id);
  if (!link || link.stopped || !link.characteristic || !link.device.gatt?.connected) throw new Error('Bluetooth is not connected.');
  if (!transmitAllowed.has(id)) throw new Error('TX is blocked or the interface is disabled.');
  if (link.pendingWrites >= 8) throw new Error('Bluetooth transmit queue is full.');
  link.pendingWrites++;
  const characteristic = link.characteristic;
  const write = link.writeQueue.catch(() => undefined).then(async () => {
    for (let offset = 0; offset < bytes.length; offset += 20) {
      if (link.stopped || links.get(id) !== link || link.characteristic !== characteristic || !link.device.gatt?.connected) throw new Error('Bluetooth disconnected during transmission.');
      if (!transmitAllowed.has(id)) throw new Error('TX is blocked or the interface is disabled.');
      await characteristic.writeValueWithoutResponse(bytes.slice(offset, offset + 20));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  link.writeQueue = write;
  try { await write; } finally { link.pendingWrites--; }
}
export function reconcileBle(interfaces: Array<{ id: string; type: string; enabled: boolean; txBlocked: boolean }>): void {
  transmitAllowed.clear();
  for (const item of interfaces) if (item.type === 'kiss-ble' && item.enabled && !item.txBlocked) transmitAllowed.add(item.id);
  for (const id of links.keys()) if (!interfaces.some((item) => item.id === id && item.type === 'kiss-ble' && item.enabled)) disconnectBle(id);
  if (scanning && !interfaces.some((item) => item.id === scanning && item.type === 'kiss-ble' && item.enabled)) disconnectBle(scanning);
}

import { encodeKissFrame } from './aprsMessages';

export interface BeaconSettings {
  callsign: string;
  ssid: string;
  location: string;
  comment: string;
  symbolTable: string;
  symbolCode: string;
  symbolOverlay: string;
  beaconPath: string;
}

function formatCoordinate(value: number, longitude: boolean): string {
  const limit = longitude ? 180 : 90;
  if (!Number.isFinite(value) || Math.abs(value) > limit)
    throw new Error('Invalid station coordinates.');
  const hundredths = Math.round(Math.abs(value) * 6000);
  const degrees = Math.floor(hundredths / 6000);
  const minutes = (hundredths % 6000) / 100;
  const hemisphere = longitude
    ? value < 0
      ? 'W'
      : 'E'
    : value < 0
      ? 'S'
      : 'N';
  return `${String(degrees).padStart(longitude ? 3 : 2, '0')}${minutes.toFixed(2).padStart(5, '0')}${hemisphere}`;
}

export function encodeBeacon(station: BeaconSettings): Uint8Array {
  const coordinates = station.location
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!coordinates) throw new Error('Invalid station coordinates.');
  const latitude = formatCoordinate(Number(coordinates[1]), false);
  const longitude = formatCoordinate(Number(coordinates[2]), true);
  if (station.symbolTable !== '/' && station.symbolTable !== '\\')
    throw new Error('Invalid APRS symbol table.');
  if (!/^[!-~]$/.test(station.symbolCode))
    throw new Error('Invalid APRS symbol code.');
  if (
    station.symbolOverlay &&
    (station.symbolTable !== '\\' || !/^[A-Z0-9]$/.test(station.symbolOverlay))
  )
    throw new Error('Invalid APRS symbol overlay.');
  const table = station.symbolOverlay || station.symbolTable;
  const info = `=${latitude}${table}${longitude}${station.symbolCode}${station.comment.trim()}`;
  return encodeKissFrame(
    `${station.callsign}${station.ssid}`,
    info,
    station.beaconPath,
  );
}

export interface BeaconInterface {
  id: string;
  name: string;
  enabled: boolean;
  txBlocked: boolean;
}

export function selectBeaconInterfaces<T extends BeaconInterface>(
  interfaces: T[],
  selectedId: string,
  canTransmit: (item: T) => boolean,
): T[] {
  if (selectedId) {
    const selected = interfaces.find((item) => item.id === selectedId);
    if (!selected) throw new Error('The selected beacon interface no longer exists. Choose another interface in My Station.');
    const name = selected.name || selected.id;
    if (!selected.enabled) throw new Error(`Beacon interface "${name}" is disabled. Choose an enabled interface in My Station.`);
    if (selected.txBlocked) throw new Error(`TX is blocked on beacon interface "${name}". Unblock TX in Interfaces or choose another interface in My Station.`);
    if (!canTransmit(selected)) throw new Error(`Beacon interface "${name}" is not connected or cannot transmit.`);
    return [selected];
  }
  const selected = interfaces.filter((item) => item.enabled && !item.txBlocked && canTransmit(item));
  if (!selected.length) throw new Error('No connected transmit interface is available for the beacon.');
  return selected;
}

export async function transmitBeacon<T extends BeaconInterface>(
  interfaces: T[],
  frame: Uint8Array,
  transmit: (id: string, frame: Uint8Array) => Promise<void>,
): Promise<{ sent: T[]; failed: Array<{ interface: T; error: string }> }> {
  const results = await Promise.allSettled(interfaces.map((item) => Promise.resolve().then(() => transmit(item.id, frame))));
  const sent: T[] = [];
  const failed: Array<{ interface: T; error: string }> = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') sent.push(interfaces[index]);
    else failed.push({ interface: interfaces[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  if (!sent.length) throw new Error(`Beacon transmission failed: ${failed.map(({ interface: item, error }) => `${item.name || item.id}: ${error}`).join('; ')}`);
  return { sent, failed };
}

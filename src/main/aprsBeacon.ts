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

export interface AprsPosition {
  callsign: string;
  latitude: number;
  longitude: number;
  symbol: string;
  comment: string;
  entityType?: 'object' | 'item';
  owner?: string;
  alive?: boolean;
}

export function unwrapAprsPacket(packet: string): string | undefined {
  const match = packet.match(/^\s*([^>]+)>\s*([^,:]+)(?:,[^:]*)?:(.*)$/s);
  if (!match) return undefined;
  if (!match[3].startsWith('}')) return packet;
  const inner = match[3].slice(1).trimStart();
  const parsed = inner.match(/^\s*([^>]+)>\s*([^,:]+)(?:,[^:]*)?:(.*)$/s);
  return parsed && !parsed[3].startsWith('}') ? inner : undefined;
}

export function decodeAprsPosition(packet: string): AprsPosition | undefined {
  const effectivePacket = unwrapAprsPacket(packet);
  if (!effectivePacket) return undefined;
  const match = effectivePacket.match(/^\s*([^>]+)>\s*([^,:]+)(?:,[^:]*)?:(.*)$/s);
  if (!match) return undefined;
  const [, source, destination, rawInfo] = match;
  const callsign = source.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}(?:-\d{1,2})?$/.test(callsign)) return undefined;
  const info = rawInfo.trimStart();
  let position: Omit<AprsPosition, 'callsign'> | undefined;
  let entityName: string | undefined;
  let entityType: 'object' | 'item' | undefined;
  let alive = true;
  if (info && '!=/@'.includes(info[0])) {
    const timestamped = info[0] === '/' || info[0] === '@';
    position = decodeRegular(info, timestamped);
  } else if (info[0] === "'" || info[0] === '`') {
    position = decodeMicE(destination.trim().split('-')[0], info);
  } else if (info[0] === ';' && info.length >= 18 && /^[*_]$/.test(info[10]) && /^\d{6}[zh/]$/.test(info.slice(11, 18))) {
    entityName = info.slice(1, 10).trim().toUpperCase();
    if (!entityName || !/^[\x20-\x7e]{1,9}$/.test(entityName)) return undefined;
    entityType = 'object'; alive = info[10] === '*';
    position = decodeRegular(`!${info.slice(18)}`, false);
  } else if (info[0] === ')') {
    const delimiter = info.slice(1, 11).search(/[!_]/);
    if (delimiter < 3 || delimiter > 9) return undefined;
    entityName = info.slice(1, delimiter + 1).trim().toUpperCase();
    if (entityName.length < 3 || !/^[\x20-\x7e]{3,9}$/.test(entityName)) return undefined;
    entityType = 'item'; alive = info[delimiter + 1] === '!';
    position = decodeRegular(`!${info.slice(delimiter + 2)}`, false);
  }
  if (!position || !valid(position.latitude, position.longitude))
    return undefined;
  return entityType ? { callsign: entityName!, ...position, entityType, owner: callsign.replace(/-0$/, ''), alive } : { callsign, ...position };
}

function decodeRegular(
  info: string,
  timestamped: boolean,
): Omit<AprsPosition, 'callsign'> | undefined {
  if (timestamped && !/^\d{6}[zh/]$/.test(info.slice(1, 8))) return undefined;
  const body = info.slice(timestamped ? 8 : 1);
  if (/^\d{2}[\d ]{2}\.[\d ]{2}[NS]/.test(body)) {
    const table = body[8];
    const lat = body.slice(0, 8);
    const lon = body.slice(9, 18);
    const symbol = body[18];
    const latitude = decodeDegrees(lat, 2, 'NS');
    const longitude = decodeDegrees(lon, 3, 'EW');
    if (
      latitude === undefined ||
      longitude === undefined ||
      !validSymbolTable(table) ||
      !isPrintable(symbol)
    )
      return undefined;
    return {
      latitude,
      longitude,
      symbol: table + symbol,
      comment: body.slice(19).trim(),
    };
  }
  if (body.length < 13) return undefined;
  const table = normalizeTable(body[0]);
  const lat = body.slice(1, 5);
  const lon = body.slice(5, 9);
  const symbol = body[9];
  if (
    !/^[!-{]{4}$/.test(lat) ||
    !/^[!-{]{4}$/.test(lon) ||
    !/^[ -{]{3}$/.test(body.slice(10, 13)) ||
    !validSymbolTable(table) ||
    !isPrintable(symbol)
  )
    return undefined;
  const latitude = 90 - base91(lat) / 380926;
  const longitude = -180 + base91(lon) / 190463;
  return {
    latitude,
    longitude,
    symbol: table + symbol,
    comment: body.slice(13).trim(),
  };
}

function decodeDegrees(
  value: string,
  degreeDigits: number,
  hemispheres: string,
): number | undefined {
  const expression =
    degreeDigits === 2
      ? /^(\d{2})(\d{2})\.(\d{2})([NS])$/
      : /^(\d{3})(\d{2})\.(\d{2})([EW])$/;
  const m = value.match(expression);
  if (!m) return undefined;
  const degrees = Number(m[1]);
  const minutes = Number(`${m[2]}.${m[3]}`);
  if (
    minutes >= 60 ||
    degrees > (degreeDigits === 2 ? 90 : 180) ||
    (degrees === (degreeDigits === 2 ? 90 : 180) && minutes !== 0) ||
    !hemispheres.includes(m[4])
  )
    return undefined;
  return (m[4] === 'S' || m[4] === 'W' ? -1 : 1) * (degrees + minutes / 60);
}

function decodeMicE(
  destination: string,
  info: string,
): Omit<AprsPosition, 'callsign'> | undefined {
  if (destination.length !== 6 || info.length < 9) return undefined;
  const digits = [...destination].map(micDigit);
  if (digits.some((d) => d === undefined)) return undefined;
  const latDigits = digits as number[];
  const ambiguous = [...destination].findIndex((char) => 'KLZ'.includes(char));
  if (ambiguous !== -1) {
    if (ambiguous < 2 || ![...destination.slice(ambiguous)].every((char) => 'KLZ'.includes(char))) return undefined;
    latDigits[ambiguous] = 5;
    latDigits.fill(0, ambiguous + 1);
  }
  const latitudeMinutes =
    latDigits[2] * 10 + latDigits[3] + latDigits[4] / 10 + latDigits[5] / 100;
  if (latitudeMinutes >= 60 || !/^[\x1c-\x7f]{3}$/.test(info.slice(1, 4)))
    return undefined;
  const latitude = latDigits[0] * 10 + latDigits[1] + latitudeMinutes / 60;
  const lat = micFlag(destination[3]) ? latitude : -latitude;
  let degrees = info.charCodeAt(1) - 28;
  if (micFlag(destination[4])) degrees += 100;
  if (degrees >= 180 && degrees <= 189) degrees -= 80;
  else if (degrees >= 190 && degrees <= 199) degrees -= 190;
  let minutes = info.charCodeAt(2) - 28;
  if (minutes >= 60) minutes -= 60;
  const hundredths = info.charCodeAt(3) - 28;
  const longitude =
    (micFlag(destination[5]) ? -1 : 1) *
    (degrees + (minutes + hundredths / 100) / 60);
  if (!validSymbolTable(info[8]) || !isPrintable(info[7])) return undefined;
  return {
    latitude: lat,
    longitude,
    symbol: info[8] + info[7],
    comment: info
      .slice(9)
      .replace(/^[\x1c-\x1f]+/, '')
      .trim(),
  };
}

function micDigit(char: string): number | undefined {
  if (/^[0-9]$/.test(char)) return Number(char);
  if (/^[A-J]$/.test(char)) return char.charCodeAt(0) - 65;
  if (/^[P-Y]$/.test(char)) return char.charCodeAt(0) - 80;
  if (/^[KLZ]$/.test(char)) return 0;
  return undefined;
}
function micFlag(char: string): boolean {
  return /^[A-JP-Z]$/.test(char);
}
function base91(value: string): number {
  return [...value].reduce((n, char) => n * 91 + char.charCodeAt(0) - 33, 0);
}
function validSymbolTable(value: string): boolean {
  return value === '/' || value === '\\' || /^[A-Z0-9]$/.test(value);
}
function normalizeTable(value: string): string {
  return /^[a-j]$/.test(value) ? String(value.charCodeAt(0) - 97) : value;
}
function isPrintable(value: string | undefined): boolean {
  return !!value && value.charCodeAt(0) >= 33 && value.charCodeAt(0) <= 126;
}
function valid(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

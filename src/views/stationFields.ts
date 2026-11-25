import type { Station } from '../types';
import type { Coordinates } from '../components/LocationPicker';

export function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return '';
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

export function stationDistanceKm(station: Station, ownPosition?: Coordinates): number | undefined {
  if (!ownPosition) return undefined;
  const rad = Math.PI / 180;
  const latitude = (station.latitude - ownPosition.latitude) * rad;
  const longitude = (station.longitude - ownPosition.longitude) * rad;
  const haversine = Math.sin(latitude / 2) ** 2 +
    Math.cos(ownPosition.latitude * rad) * Math.cos(station.latitude * rad) *
      Math.sin(longitude / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

export function stationFields(
  station: Station,
  ownPosition?: Coordinates,
): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  const add = (label: string, value: string | undefined) => {
    if (value) fields.push([label, value]);
  };
  add('APRS client', station.aprsClient);
  const device = station.aprsDevice;
  if (device) {
    add(device.identifierKind === 'tocall' ? 'TOCALL' : 'Mic-E', device.actualIdentifier);
    add('Vendor', device.vendor);
    add('Model', device.model);
    add('Class', device.classLabel);
    add('Class description', device.classDescription);
    add('OS', device.os);
    add('Capabilities', device.features.join(', '));
  }
  add('Last activity', new Date(station.lastHeard).toLocaleString());
  if (station.entityType) add('Owner', station.owner);
  add('Interface', station.sourceInterface);
  add('Destination', station.destination);
  add('Path', station.path || 'Direct');
  add(
    'Position',
    `${station.latitude.toFixed(5)}, ${station.longitude.toFixed(5)}`,
  );
  if (station.positionReceivedAt)
    add(
      'Position received',
      new Date(station.positionReceivedAt).toLocaleString(),
    );
  if (ownPosition) {
    const rad = Math.PI / 180;
    const a = ownPosition.latitude * rad;
    const b = station.latitude * rad;
    const longitude = (station.longitude - ownPosition.longitude) * rad;
    const distance = stationDistanceKm(station, ownPosition)!;
    const bearing =
      (Math.atan2(
        Math.sin(longitude) * Math.cos(b),
        Math.cos(a) * Math.sin(b) -
          Math.sin(a) * Math.cos(b) * Math.cos(longitude),
      ) /
        rad +
        360) %
      360;
    add('Distance', `${distance.toFixed(1)} km, ${Math.round(bearing) % 360}°`);
  }
  const data = station.decoded;
  if (data?.courseDegrees !== undefined)
    add('Course', `${data.courseDegrees}°`);
  if (data?.speedKnots !== undefined)
    add('Speed', `${(data.speedKnots * 1.852).toFixed(1)} km/h`);
  if (data?.altitudeFeet !== undefined)
    add('Altitude', `${Math.round(data.altitudeFeet * 0.3048)} m`);
  if (data?.phg) {
    const direction = ['Omni', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'][
      data.phg.direction
    ];
    add(
      'PHG',
      `${data.phg.powerWatts} W, ${Math.round(data.phg.heightFeet * 0.3048)} m, ${data.phg.gainDbi} dBi, ${direction}`,
    );
  }
  if (data?.qsy) {
    const { frequencyMHz, tone, offsetKHz } = data.qsy;
    add(
      'QSY',
      [
        `${frequencyMHz.toFixed(3)} MHz`,
        tone,
        offsetKHz === undefined
          ? undefined
          : `${offsetKHz > 0 ? '+' : ''}${offsetKHz} kHz`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
  const weather = data?.weather;
  if (weather?.temperatureC !== undefined)
    add('Temperature', `${weather.temperatureC.toFixed(1)} °C`);
  if (weather?.humidityPercent !== undefined)
    add('Humidity', `${weather.humidityPercent}%`);
  if (weather?.pressureHpa !== undefined)
    add('Pressure', `${weather.pressureHpa.toFixed(1)} hPa`);
  if (weather?.windMph !== undefined)
    add(
      'Wind',
      `${weather.windDegrees}°, ${(weather.windMph * 1.609344).toFixed(1)} km/h`,
    );
  if (weather?.gustMph !== undefined)
    add('Wind gust', `${(weather.gustMph * 1.609344).toFixed(1)} km/h`);
  add('Comment', station.comment);
  add('Status', station.status);
  return fields;
}

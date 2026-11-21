import type { AprsDecodedData } from '../types';

// Position extensions follow APRSBox's content parser. Values retain APRS units.
export function decodeAprsExtensions(
  packet: string,
  comment: string,
  symbol: string,
): AprsDecodedData {
  const data: AprsDecodedData = {};
  const info = packet.slice(packet.indexOf(':') + 1);
  if ((info[0] === "'" || info[0] === '`') && info.length >= 9) {
    const bytes = Array.from(
      info.slice(4, 7),
      (char) => char.charCodeAt(0) - 28,
    );
    if (bytes.length === 3 && bytes.every((byte) => byte >= 0 && byte <= 99)) {
      let speed = bytes[0] * 10 + Math.floor(bytes[1] / 10);
      let course = (bytes[1] % 10) * 100 + bytes[2];
      if (speed >= 800) speed -= 800;
      if (course >= 400) course -= 400;
      if (speed >= 0 && speed < 800 && course <= 360) {
        data.speedKnots = speed;
        data.courseDegrees = course;
      }
    }
    const payload = info.slice(9).replace(/^[ >\]`']/, '');
    if (
      payload.length >= 4 &&
      payload[3] === '}' &&
      /^[!-{]{3}$/.test(payload.slice(0, 3))
    ) {
      const altitude =
        8192 * (payload.charCodeAt(0) - 33) +
        91 * (payload.charCodeAt(1) - 33) +
        payload.charCodeAt(2) -
        33 -
        10000;
      if (altitude >= 0 && altitude <= 32700) data.altitudeFeet = altitude;
    }
  } else if (!symbol.endsWith('_')) {
    const movement = comment.match(/(?<!\d)(\d{3})\/(\d{3})(?!\d)/);
    if (movement && Number(movement[1]) <= 360) {
      data.courseDegrees = Number(movement[1]);
      data.speedKnots = Number(movement[2]);
    }
  }
  const altitude = comment.match(/(?:^|[\s/])A=(\d{6})/);
  if (altitude) data.altitudeFeet = Number(altitude[1]);
  const phg = comment.match(/PHG(\d)(\d)(\d)([0-8])(?!\d)/i);
  if (phg)
    data.phg = {
      powerWatts: Number(phg[1]) ** 2,
      heightFeet: 10 * 2 ** Number(phg[2]),
      gainDbi: Number(phg[3]),
      direction: Number(phg[4]),
    };
  const qsy = comment.match(
    /(\d{3}\.\d{3,4})mhz(?:\s+([CT]\d{3}))?(?:\s+([+-]\d{3,4}))?/i,
  );
  if (qsy)
    data.qsy = {
      frequencyMHz: Number(qsy[1]),
      tone: qsy[2],
      offsetKHz: qsy[3] === undefined ? undefined : Number(qsy[3]) * 10,
    };
  if (symbol.endsWith('_')) {
    const temperature = comment.match(/t(-?\d{3})/);
    const humidity = comment.match(/h(\d{2})/);
    const pressure = comment.match(/b(\d{5})/);
    const wind = comment.match(/(?:^|[^\d])(\d{3})\/(\d{3})/);
    const gust = comment.match(/g(\d{3})/);
    const weather: NonNullable<AprsDecodedData['weather']> = {};
    if (temperature)
      weather.temperatureC = ((Number(temperature[1]) - 32) * 5) / 9;
    if (humidity) weather.humidityPercent = Number(humidity[1]) || 100;
    if (pressure) weather.pressureHpa = Number(pressure[1]) / 10;
    if (wind && Number(wind[1]) <= 360) {
      weather.windDegrees = Number(wind[1]);
      weather.windMph = Number(wind[2]);
    }
    if (gust) weather.gustMph = Number(gust[1]);
    if (Object.keys(weather).length) data.weather = weather;
  }
  return data;
}

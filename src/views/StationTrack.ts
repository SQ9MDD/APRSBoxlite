import L from 'leaflet';
import type { Station } from '../types';

const trackColors = ['#ff2da3', '#00d7ff', '#a77bff', '#ff7a00', '#00e6b8'];

export function colorFor(callsign: string): string {
  let hash = 0;
  for (const char of callsign) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return trackColors[hash % trackColors.length];
}

export function createStationTrack(station: Station): L.LayerGroup {
  const layer = L.layerGroup();
  const points: L.LatLngTuple[] = station.track.map((point) => [
    point.latitude,
    point.longitude,
  ]);
  if (points.length < 2) return layer;

  const color = colorFor(station.callsign);
  const lightTheme = document.documentElement.dataset.theme === 'light';
  const contrastColor = lightTheme
    ? 'rgba(16, 24, 40, 0.82)'
    : 'rgba(255, 255, 255, 0.92)';
  const lineOptions: L.PolylineOptions = {
    lineJoin: 'round',
    lineCap: 'round',
    interactive: false,
  };
  L.polyline(points, {
    ...lineOptions,
    color: contrastColor,
    weight: 3,
    opacity: lightTheme ? 0.72 : 0.82,
  }).addTo(layer);
  L.polyline(points, {
    ...lineOptions,
    color,
    weight: 1.75,
    opacity: 0.96,
  }).addTo(layer);

  // APRSBox marks earlier positions with dots; the station icon marks the latest.
  for (const point of points.slice(0, -1)) {
    L.circleMarker(point, {
      radius: 4,
      color: contrastColor,
      fillColor: color,
      fillOpacity: 0.94,
      opacity: 0.96,
      weight: 2,
      interactive: false,
    }).addTo(layer);
  }
  return layer;
}

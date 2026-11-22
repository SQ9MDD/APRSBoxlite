import L from 'leaflet';
import type { Station } from '../types';

const trackColors = ['#ff2da3', '#00d7ff', '#a77bff', '#ff7a00', '#00e6b8'];

function colorFor(callsign: string): string {
  let hash = 0;
  for (const char of callsign) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return trackColors[hash % trackColors.length];
}

// APRSBox uses a circle for omnidirectional PHG and a cardioid for directional PHG.
function coverage(station: Station, fillOpacity: number): L.Layer | undefined {
  if (!station.phg || station.phg.rangeKm <= 0) return undefined;
  const { rangeKm, direction } = station.phg;
  const color = colorFor(station.callsign);
  const options: L.PathOptions = {
    color,
    weight: 1.5,
    opacity: 1,
    fillOpacity,
    interactive: false,
  };
  const radius = rangeKm * 1000;
  if (direction === 0)
    return L.circle([station.latitude, station.longitude], {
      ...options,
      radius,
    });
  const azimuth = ((direction % 8) * 45 * Math.PI) / 180;
  const latitude = (station.latitude * Math.PI) / 180;
  const longitude = (station.longitude * Math.PI) / 180;
  const points: L.LatLngTuple[] = [];
  for (let i = 0; i < 96; i++) {
    const theta = (i * Math.PI * 2) / 96;
    const offset = radius / 3;
    const radial = ((radius + offset) * (1 + Math.cos(theta))) / 2;
    const x = radial * Math.sin(theta);
    const y = radial * Math.cos(theta) - offset;
    const rotatedX = x * Math.cos(azimuth) + y * Math.sin(azimuth);
    const rotatedY = -x * Math.sin(azimuth) + y * Math.cos(azimuth);
    const distance = Math.hypot(rotatedX, rotatedY) / 6371000;
    const bearing = Math.atan2(rotatedX, rotatedY);
    const targetLat = Math.asin(
      Math.sin(latitude) * Math.cos(distance) +
        Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing),
    );
    const targetLon =
      longitude +
      Math.atan2(
        Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude),
        Math.cos(distance) - Math.sin(latitude) * Math.sin(targetLat),
      );
    points.push([
      (targetLat * 180) / Math.PI,
      (((targetLon * 180) / Math.PI + 540) % 360) - 180,
    ]);
  }
  return L.polygon(points, options);
}

function locator(
  lonIndex: number,
  latIndex: number,
  precision: number,
): string {
  const cells =
    precision === 2
      ? 18
      : precision === 4
        ? 180
        : precision === 6
          ? 4320
          : 43200;
  const lon = ((lonIndex % cells) + cells) % cells;
  const lat = Math.max(0, Math.min(cells - 1, latIndex));
  const fieldDivisor = cells / 18;
  let result = String.fromCharCode(
    65 + Math.floor(lon / fieldDivisor),
    65 + Math.floor(lat / fieldDivisor),
  );
  if (precision >= 4) {
    const divisor = cells / 180;
    result +=
      String(Math.floor(lon / divisor) % 10) +
      String(Math.floor(lat / divisor) % 10);
  }
  if (precision >= 6) {
    const divisor = precision === 6 ? 1 : 10;
    result += String.fromCharCode(
      65 + (Math.floor(lon / divisor) % 24),
      65 + (Math.floor(lat / divisor) % 24),
    );
  }
  if (precision === 8) result += String(lon % 10) + String(lat % 10);
  return result;
}

export function createMapOverlays(map: L.Map, fillOpacity = 0.05) {
  const tracks = L.layerGroup().addTo(map);
  const coverages = L.layerGroup().addTo(map);
  const grid = L.layerGroup().addTo(map);
  let stations: Station[] = [];
  let visibility = { tracks: false, coverage: false, grid: false };
  const pane = map.createPane('maidenhead-grid');
  pane.style.zIndex = '450';
  pane.style.pointerEvents = 'none';

  function renderStations() {
    tracks.clearLayers();
    coverages.clearLayers();
    for (const station of stations) {
      if (
        visibility.tracks &&
        station.kind === 'mobile' &&
        station.track.length > 1
      ) {
        const points: L.LatLngTuple[] = station.track.map((point) => [
          point.latitude,
          point.longitude,
        ]);
        L.polyline(points, {
          color: '#111827',
          weight: 3,
          opacity: 0.8,
          interactive: false,
        }).addTo(tracks);
        L.polyline(points, {
          color: colorFor(station.callsign),
          weight: 1.75,
          opacity: 0.96,
          interactive: false,
        }).addTo(tracks);
      }
      if (visibility.coverage) {
        const layer = coverage(station, fillOpacity);
        if (layer) layer.addTo(coverages);
      }
    }
  }

  function renderGrid() {
    grid.clearLayers();
    if (!visibility.grid) return;
    const zoom = map.getZoom();
    const precision = zoom <= 5 ? 2 : zoom <= 10 ? 4 : zoom <= 14 ? 6 : 8;
    const lonStep =
      precision === 2
        ? 20
        : precision === 4
          ? 2
          : precision === 6
            ? 1 / 12
            : 1 / 120;
    const latStep = lonStep / 2;
    const bounds = map.getBounds();
    const x0 = Math.floor((bounds.getWest() + 180) / lonStep);
    const x1 = Math.ceil((bounds.getEast() + 180) / lonStep);
    const y0 = Math.max(
      0,
      Math.floor((Math.max(-90, bounds.getSouth()) + 90) / latStep),
    );
    const y1 = Math.min(
      Math.round(180 / latStep),
      Math.ceil((Math.min(90, bounds.getNorth()) + 90) / latStep),
    );
    const options: L.PolylineOptions = {
      pane: 'maidenhead-grid',
      interactive: false,
      color: '#374151',
      opacity: 0.7,
      weight: precision === 2 ? 1.8 : 1.35,
    };
    for (let x = x0; x <= x1; x++)
      L.polyline(
        [
          [-90 + y0 * latStep, -180 + x * lonStep],
          [-90 + y1 * latStep, -180 + x * lonStep],
        ],
        options,
      ).addTo(grid);
    for (let y = y0; y <= y1; y++)
      L.polyline(
        [
          [-90 + y * latStep, -180 + x0 * lonStep],
          [-90 + y * latStep, -180 + x1 * lonStep],
        ],
        options,
      ).addTo(grid);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        L.marker([-90 + (y + 0.5) * latStep, -180 + (x + 0.5) * lonStep], {
          pane: 'maidenhead-grid',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'maidenhead-grid-label',
            html: `<span>${locator(x, y, precision)}</span>`,
            iconSize: [0, 0],
          }),
        }).addTo(grid);
      }
    }
  }

  map.on('moveend zoomend', renderGrid);
  return {
    updateStations(value: Station[]) {
      stations = value;
      renderStations();
    },
    setVisibility(value: typeof visibility) {
      visibility = value;
      renderStations();
      renderGrid();
    },
    dispose() {
      map.off('moveend zoomend', renderGrid);
      tracks.remove();
      coverages.remove();
      grid.remove();
    },
  };
}

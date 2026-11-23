import L from 'leaflet';
import type { Station } from '../types';
import type { MapSource } from '../mapSettings';
import { mapTileUrl } from '../mapSettings';
import { escapeHtml } from '../components/escapeHtml';
import { createStationTrack } from './StationTrack';

const symbols = import.meta.glob('../components/icons/aprs-symbols/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

export function mountStationDetailMap(element: HTMLElement, station: Station, source: MapSource): {
  update: (station: Station) => void;
  dispose: () => void;
} {
  const map = L.map(element, { zoomControl: false }).setView([station.latitude, station.longitude], 10);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer(mapTileUrl(source), {
    maxZoom: 19, minZoom: source.minZoom, maxNativeZoom: source.maxZoom, attribution: escapeHtml(source.attribution),
  }).addTo(map);
  const icon = (value: Station) => {
    const [table, code] = value.symbol;
    const index = (code?.charCodeAt(0) ?? 0) - 33;
    const src = symbols[`../components/icons/aprs-symbols/${table === '/' ? '' : 'a'}${String(index).padStart(2, '0')}.png`] ?? symbols['../components/icons/aprs-symbols/x.png'];
    const content = document.createElement('span');
    content.className = 'stations-symbol';
    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    content.append(image);
    if (/^[A-Z0-9]$/.test(table)) {
      const overlay = document.createElement('span');
      overlay.textContent = table;
      content.append(overlay);
    }
    return L.divIcon({ className: 'aprs-marker-wrapper', html: content, iconSize: [28, 28], iconAnchor: [14, 14] });
  };
  const marker = L.marker([station.latitude, station.longitude], { icon: icon(station), title: station.callsign }).addTo(map);
  const track = L.layerGroup().addTo(map);
  const update = (value: Station) => {
    marker.setLatLng([value.latitude, value.longitude]);
    marker.setIcon(icon(value));
    track.clearLayers();
    createStationTrack(value).addTo(track);
  };
  update(station);
  requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  return { update, dispose: () => map.remove() };
}

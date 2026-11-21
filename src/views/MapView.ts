import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Station } from '../types';

interface MapViewOptions {
  stations: Station[];
  onStationSelected: (station: Station) => void;
  resetCenter: [number, number];
}

export function renderMapView({
  stations,
  onStationSelected,
  resetCenter,
}: MapViewOptions): {
  html: string;
  mount: (element: HTMLElement) => () => void;
} {
  return {
    html: `<div class="map-view"><div id="aprs-map" class="aprs-map" aria-label="APRS station map"></div></div>`,
    mount: (element) => {
      const mapElement = element.querySelector<HTMLDivElement>('#aprs-map');
      if (!mapElement) return () => undefined;
      const map = L.map(mapElement, {
        zoomControl: false,
        attributionControl: true,
      }).setView(resetCenter, 12);
      const resetMapView = () => map.setView(resetCenter, 12);
      window.addEventListener('aprs-map:reset', resetMapView);
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      stations.forEach((station) => {
        const marker = L.marker([station.latitude, station.longitude], {
          icon: L.divIcon({
            className: 'aprs-marker-wrapper',
            html: `<span class="aprs-marker kind-${station.kind}">${station.symbol}</span><span class="marker-label">${station.callsign}</span>`,
            iconSize: [120, 38],
            iconAnchor: [18, 18],
          }),
        }).addTo(map);
        marker.on('click', () => onStationSelected(station));
        marker.bindTooltip(
          `${station.callsign}<br><small>${station.name}</small>`,
          { direction: 'top', offset: [0, -17] },
        );
      });
      return () => {
        window.removeEventListener('aprs-map:reset', resetMapView);
        map.remove();
      };
    },
  };
}

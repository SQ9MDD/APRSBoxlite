import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface MountedLocationPicker {
  getCenter: () => Coordinates;
  dispose: () => void;
}

export function createLocationPicker(center: Coordinates): string {
  return `<div class="modal-backdrop location-picker-backdrop"><section class="location-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="location-picker-title"><div class="dialog-header"><div><h3 id="location-picker-title">Pick location on map</h3><p>Pan the map until the crosshair is at the station location.</p></div><button data-action="close-location-picker" type="button" aria-label="Close location picker">×</button></div><div class="location-picker-map-wrap"><div id="station-location-picker" class="location-picker-map" aria-label="Location picker map"></div><span class="location-picker-crosshair" aria-hidden="true">+</span></div><p class="location-picker-coordinates" data-picker-coordinates>${formatCoordinates(center)}</p><div class="form-actions"><button class="outline-button" data-action="close-location-picker" type="button">Cancel</button><button class="primary-button" data-action="use-picker-location" type="button">Use Location</button></div></section></div>`;
}

export function mountLocationPicker(
  element: ParentNode,
  initialCenter: Coordinates,
): MountedLocationPicker | undefined {
  const mapElement = element.querySelector<HTMLDivElement>(
    '#station-location-picker',
  );
  const label = element.querySelector<HTMLElement>('[data-picker-coordinates]');
  if (!mapElement) return undefined;
  const map = L.map(mapElement, {
    zoomControl: true,
    attributionControl: true,
  }).setView([initialCenter.latitude, initialCenter.longitude], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  const updateCenter = () => {
    if (label)
      label.textContent = formatCoordinates(toCoordinates(map.getCenter()));
  };
  map.on('move', updateCenter);
  requestAnimationFrame(() => map.invalidateSize());
  return {
    getCenter: () => toCoordinates(map.getCenter()),
    dispose: () => map.remove(),
  };
}

export function formatCoordinates(coordinates: Coordinates): string {
  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
}

function toCoordinates(latLng: L.LatLng): Coordinates {
  return { latitude: latLng.lat, longitude: latLng.lng };
}

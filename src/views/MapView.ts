import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Station } from '../types';
import { createMapOverlays } from './MapOverlays';
import { createMapRuler, type RulerState } from './MapRuler';
import { createPacketRoutes } from './PacketRoutes';
import { relativeTime, stationFields } from './stationFields';
import type { Coordinates } from '../components/LocationPicker';
import type { MapSettings } from '../mapSettings';
import { activeMapSource, mapTileUrl } from '../mapSettings';
import { escapeHtml } from '../components/escapeHtml';
import { renderComment } from '../components/commentLink';

const symbols = import.meta.glob('../components/icons/aprs-symbols/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

interface MapViewOptions {
  subscribeToStations: (update: (stations: Station[]) => void) => () => void;
  resetCenter: () => [number, number];
  viewport: MapViewport | undefined;
  onViewportChanged: (viewport: MapViewport) => void;
  overlayVisibility: () => {
    tracks: boolean;
    coverage: boolean;
    grid: boolean;
    ruler: boolean;
    packetRoutes: boolean;
  };
  rulerState: RulerState;
  onStationAction: (action: 'message' | 'details', callsign: string) => void;
  ownPosition: () => Coordinates | undefined;
  ownCallsign: () => string;
  mapSettings: MapSettings;
}

export interface MapViewport {
  latitude: number;
  longitude: number;
  zoom: number;
}

function stationIcon(station: Station): L.DivIcon {
  const [table, code] = station.symbol;
  const index = (code?.charCodeAt(0) ?? 0) - 33;
  const iconPath = (name: string) =>
    symbols[`../components/icons/aprs-symbols/${name}.png`];
  const image = document.createElement('img');
  image.src =
    iconPath(`${table === '/' ? '' : 'a'}${String(index).padStart(2, '0')}`) ??
    iconPath('x');
  image.alt = '';
  image.width = image.height = 28;

  const content = document.createElement('span');
  content.append(image);
  if (/^[A-Z0-9]$/.test(table)) {
    const overlay = document.createElement('span');
    overlay.className = 'aprs-marker-overlay';
    overlay.textContent = table;
    content.append(overlay);
  }
  const label = document.createElement('span');
  label.className = 'marker-label';
  label.textContent = station.callsign;
  content.append(label);

  return L.divIcon({
    className: 'aprs-marker-wrapper',
    html: content,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function stationDetails(
  station: Station,
  onAction: MapViewOptions['onStationAction'],
  ownPosition: Coordinates | undefined,
): HTMLElement {
  const details = document.createElement('div');
  details.className = 'map-station-popup';
  details.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>('a[data-external-link]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    void window.aprsbox.config.openExternal(link.getAttribute('href') ?? '').catch(console.error);
  });
  const title = document.createElement('strong');
  title.textContent = station.callsign;
  details.append(title);
  const fields = stationFields(station, ownPosition);
  const list = document.createElement('dl');
  list.className = 'map-station-fields';
  for (const [label, value] of fields) {
    if (!value) continue;
    const labelElement = document.createElement('dt');
    labelElement.textContent = `${label}:`;
    const valueElement = document.createElement('dd');
    if (label === 'Last activity') {
      const elapsed = relativeTime(station.lastHeard);
      valueElement.textContent = elapsed ? `${value} (${elapsed})` : value;
      valueElement.dataset.lastActivity = station.lastHeard;
    } else if (label === 'Comment' || label === 'Status') valueElement.innerHTML = renderComment(value);
    else valueElement.textContent = value;
    list.append(labelElement, valueElement);
  }
  details.append(list);
  const actions = document.createElement('div');
  actions.className = 'map-station-actions';
  for (const [action, label] of [
    ['message', 'Send message'],
    ['details', 'View details'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onAction(action, action === 'message' && station.owner ? station.owner : station.callsign);
    });
    actions.append(button);
  }
  details.append(actions);
  return details;
}

export function renderMapView({
  subscribeToStations,
  resetCenter,
  viewport,
  onViewportChanged,
  overlayVisibility,
  rulerState,
  onStationAction,
  ownPosition,
  ownCallsign,
  mapSettings,
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
        minZoom: 0,
        maxZoom: 19,
      }).setView(
        viewport ? [viewport.latitude, viewport.longitude] : resetCenter(),
        viewport?.zoom ?? 12,
      );
      const syncStationLabelVisibility = () => {
        mapElement.classList.toggle(
          'map-station-labels-hidden',
          map.getZoom() <= mapSettings.stationLabelHideAtZoom,
        );
        window.dispatchEvent(new Event('aprs-map:label-visibility'));
      };
      syncStationLabelVisibility();
      map.on('zoomend', syncStationLabelVisibility);
      const saveViewport = () => {
        const center = map.getCenter();
        onViewportChanged({
          latitude: center.lat,
          longitude: center.lng,
          zoom: map.getZoom(),
        });
      };
      map.on('moveend zoomend', saveViewport);
      const resetMapView = () => map.setView(resetCenter(), 12);
      window.addEventListener('aprs-map:reset', resetMapView);
      const maskPane = map.createPane('map-mask');
      maskPane.classList.add('map-mask-pane');
      const mask = document.createElement('div');
      mask.className = 'map-mask-layer';
      maskPane.append(mask);
      const syncMask = () => {
        const position = L.DomUtil.getPosition(map.getPane('mapPane')!);
        const size = map.getSize();
        maskPane.style.left = `${-(position?.x ?? 0)}px`;
        maskPane.style.top = `${-(position?.y ?? 0)}px`;
        maskPane.style.width = `${size.x}px`;
        maskPane.style.height = `${size.y}px`;
      };
      map.on('resize zoom move', syncMask);
      syncMask();
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
      const source = activeMapSource(mapSettings);
      const centerStation = (event: Event) => {
        const { latitude, longitude, panelLeft } = (event as CustomEvent<{ latitude: number; longitude: number; panelLeft?: number }>).detail;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        const zoom = Math.min(18, source.maxZoom, map.getMaxZoom());
        const mapWidth = map.getSize().x;
        const visibleWidth = panelLeft === undefined ? mapWidth : Math.max(0, Math.min(mapWidth, panelLeft - mapElement.getBoundingClientRect().left));
        const offset = (mapWidth - visibleWidth) / 2;
        const center = map.unproject(map.project([latitude, longitude], zoom).add([offset, 0]), zoom);
        map.setView(center, zoom);
      };
      window.addEventListener('aprs-map:center-station', centerStation);
      L.tileLayer(mapTileUrl(source), {
        maxZoom: 19,
        minZoom: source.minZoom,
        maxNativeZoom: source.maxZoom,
        attribution: escapeHtml(source.attribution),
      }).addTo(map);
      const overlays = createMapOverlays(map, mapSettings.coverageFillOpacity / 100);
      const ruler = createMapRuler(map, rulerState);
      let routeStations: Station[] = [];
      const packetRoutes = createPacketRoutes(map, () => routeStations, ownPosition, ownCallsign);
      const updateVisibility = () => {
        const visibility = overlayVisibility();
        overlays.setVisibility(visibility);
        ruler.setVisible(visibility.ruler);
        packetRoutes.setVisible(visibility.packetRoutes);
      };
      updateVisibility();
      window.addEventListener('aprs-map:overlays', updateVisibility);
      const markers = new Map<string, { marker: L.Marker; station: Station }>();
      const activityTimer = setInterval(() => {
        for (const value of mapElement.querySelectorAll<HTMLElement>('[data-last-activity]')) {
          const timestamp = value.dataset.lastActivity!;
          const elapsed = relativeTime(timestamp);
          value.textContent = `${new Date(timestamp).toLocaleString()}${elapsed ? ` (${elapsed})` : ''}`;
        }
      }, 10_000);
      const unsubscribe = subscribeToStations((stations) => {
        routeStations = stations;
        overlays.updateStations(stations);
        const active = new Set<string>();
        for (const station of stations) {
          active.add(station.callsign);
          const existing = markers.get(station.callsign);
          const coordinates: L.LatLngTuple = [
            station.latitude,
            station.longitude,
          ];
          if (existing) {
            const previous = existing.station;
            if (
              station.latitude !== previous.latitude ||
              station.longitude !== previous.longitude
            ) {
              existing.marker.setLatLng(coordinates);
            }
            if (station.symbol !== previous.symbol) {
              existing.marker.setIcon(stationIcon(station));
            }
            if (
              station.lastHeard !== previous.lastHeard ||
              station.comment !== previous.comment ||
              station.status !== previous.status ||
              station.aprsClient !== previous.aprsClient ||
              station.aprsDevice !== previous.aprsDevice ||
              station.owner !== previous.owner ||
              station.sourceInterface !== previous.sourceInterface ||
              station.path !== previous.path ||
              station.latitude !== previous.latitude ||
              station.longitude !== previous.longitude
            ) {
              existing.marker.setPopupContent(
                stationDetails(station, onStationAction, ownPosition()),
              );
            }
            existing.station = station;
          } else {
            const marker = L.marker(coordinates, {
              icon: stationIcon(station),
              alt: station.callsign,
            }).addTo(map);
            const markerElement = marker.getElement();
            if (markerElement) {
              markerElement.dataset.stationTooltip = station.callsign;
              markerElement.setAttribute('aria-label', station.callsign);
            }
            marker.bindPopup(
              stationDetails(station, onStationAction, ownPosition()),
              {
                autoPan: false,
                minWidth: Math.min(380, Math.max(200, map.getSize().x - 50)),
                maxWidth: Math.max(200, Math.min(700, map.getSize().x - 50)),
                className: 'map-station-popup-container',
              },
            );
            marker.on('popupopen', () => {
              const current = markers.get(station.callsign)?.station ?? station;
              marker.setPopupContent(
                stationDetails(current, onStationAction, ownPosition()),
              );
            });
            markers.set(station.callsign, { marker, station });
          }
        }
        for (const [callsign, entry] of markers) {
          if (active.has(callsign)) continue;
          entry.marker.remove();
          markers.delete(callsign);
        }
      });
      const resize = () => map.invalidateSize({ pan: false });
      window.addEventListener('aprs-map:visible', resize);
      requestAnimationFrame(resize);
      return () => {
        clearInterval(activityTimer);
        unsubscribe();
        overlays.dispose();
        packetRoutes.dispose();
        ruler.dispose();
        window.removeEventListener('aprs-map:overlays', updateVisibility);
        window.removeEventListener('aprs-map:visible', resize);
        window.removeEventListener('aprs-map:reset', resetMapView);
        window.removeEventListener('aprs-map:center-station', centerStation);
        map.off('resize zoom move', syncMask);
        map.off('zoomend', syncStationLabelVisibility);
        map.remove();
      };
    },
  };
}

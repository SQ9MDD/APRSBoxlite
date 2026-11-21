import L from 'leaflet';

export interface RulerState {
  pointA?: L.LatLngLiteral;
  pointB?: L.LatLngLiteral;
  measurementActive: boolean;
}

function bearing(from: L.LatLng, to: L.LatLng): number {
  const radians = Math.PI / 180;
  const latA = from.lat * radians;
  const latB = to.lat * radians;
  const delta = (to.lng - from.lng) * radians;
  const y = Math.sin(delta) * Math.cos(latB);
  const x =
    Math.cos(latA) * Math.sin(latB) -
    Math.sin(latA) * Math.cos(latB) * Math.cos(delta);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

export function createMapRuler(map: L.Map, state: RulerState) {
  const layer = L.layerGroup();
  const icon = (side: 'A' | 'B') =>
    L.divIcon({
      className: 'map-ruler-picker-icon',
      html: `<span class="map-ruler-picker map-ruler-picker-${side.toLowerCase()}">${side}</span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      tooltipAnchor: [0, -12],
    });
  const initialPoints = (): [L.LatLng, L.LatLng] => {
    const size = map.getSize();
    const y = Math.max(40, size.y - 56);
    const right = Math.max(64, size.x - 24);
    const gap = Math.max(48, Math.min(90, right - 16));
    let x1 = Math.max(16, Math.min(168, right - gap));
    const x2 = Math.min(x1 + Math.max(gap, Math.min(220, right - 16)), right);
    if (x2 - x1 < gap) x1 = Math.max(16, x2 - gap);
    return [
      map.containerPointToLatLng([x1, y]),
      map.containerPointToLatLng([x2, y]),
    ];
  };
  const [initialA, initialB] = initialPoints();
  const pointA = state.pointA ?? initialA;
  const pointB = state.pointB ?? initialB;
  const halo = L.polyline([pointA, pointB], {
    color: 'white',
    weight: 8,
    opacity: 0.98,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
  }).addTo(layer);
  const line = L.polyline([pointA, pointB], {
    color: '#0078ff',
    weight: 3.4,
    opacity: 1,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
  }).addTo(layer);
  const markerA = L.marker(pointA, {
    icon: icon('A'),
    draggable: true,
    keyboard: false,
    autoPan: true,
    zIndexOffset: 1000,
  }).addTo(layer);
  const markerB = L.marker(pointB, {
    icon: icon('B'),
    draggable: true,
    keyboard: false,
    autoPan: true,
    zIndexOffset: 1000,
  }).addTo(layer);
  markerA.bindTooltip('', {
    direction: 'top',
    className: 'map-ruler-tooltip',
    opacity: 0.96,
    permanent: true,
    offset: [-28, -10],
  });
  markerB.bindTooltip('', {
    direction: 'top',
    className: 'map-ruler-tooltip',
    opacity: 0.96,
    permanent: true,
    offset: [28, -10],
  });

  const sync = () => {
    const a = markerA.getLatLng();
    const b = markerB.getLatLng();
    state.pointA = { lat: a.lat, lng: a.lng };
    state.pointB = { lat: b.lat, lng: b.lng };
    halo.setLatLngs([a, b]);
    line.setLatLngs([a, b]);
    const km = map.distance(a, b) / 1000;
    const distance = `${km.toFixed(km < 10 ? 2 : 1)} km`;
    const content = (title: string, course: number) =>
      `<div class="map-ruler-tooltip-content"><strong>${title}</strong><span>Course: ${Math.round(course)}°</span><span>Distance: ${distance}</span></div>`;
    markerA.setTooltipContent(content('A → B', bearing(a, b)));
    markerB.setTooltipContent(content('B → A', bearing(b, a)));
  };
  const anchorIfIdle = () => {
    if (state.measurementActive) return;
    const [a, b] = initialPoints();
    markerA.setLatLng(a);
    markerB.setLatLng(b);
    sync();
  };
  for (const marker of [markerA, markerB]) {
    marker.on('dragstart', () => {
      state.measurementActive = true;
    });
    marker.on('drag dragend', sync);
  }
  map.on('moveend zoomend resize', anchorIfIdle);
  sync();

  return {
    setVisible(visible: boolean) {
      if (visible && !map.hasLayer(layer)) {
        if (!state.measurementActive) anchorIfIdle();
        layer.addTo(map);
      } else if (!visible && map.hasLayer(layer)) {
        layer.remove();
      }
    },
    dispose() {
      map.off('moveend zoomend resize', anchorIfIdle);
      layer.remove();
    },
  };
}

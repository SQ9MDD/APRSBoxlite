import L from 'leaflet';
import { decodeAprsPosition } from '../main/aprsPosition';
import type { Coordinates } from '../components/LocationPicker';
import type { Station } from '../types';
import type { TrafficMonitorFrame } from './TrafficMonitorView';
import { routeSegments, routeCallsigns } from './packetRoutePath';

export function createPacketRoutes(map: L.Map, getStations: () => Station[], ownPosition: () => Coordinates | undefined, ownCallsign: () => string) {
  const layers = L.layerGroup().addTo(map);
  const routes = new Map<string, L.LayerGroup>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let visible = true;
  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  };
  const unsubscribe = window.aprsbox.traffic.onReceived((frame: TrafficMonitorFrame) => {
    if (!visible || frame.source !== 'kiss' || frame.direction !== 'rx') return;
    const callsigns = routeCallsigns(frame.packet);
    if (!callsigns || callsigns[0] === ownCallsign().trim().toUpperCase().replace(/-0$/, '')) return;
    // The traffic event precedes the station-position update from the main process.
    schedule(() => {
      if (!visible) return;
      const own = ownPosition();
      if (!own) return;
      const stations = getStations();
      const position = decodeAprsPosition(frame.packet);
      const points: Array<L.LatLngTuple | undefined> = callsigns.map((callsign, index) => {
        if (index === 0 && position && !position.entityType) return [position.latitude, position.longitude];
        const station = stations.find((item) => !item.entityType && item.callsign.toUpperCase().replace(/-0$/, '') === callsign);
        return station ? [station.latitude, station.longitude] : undefined;
      });
      points.push([own.latitude, own.longitude]);
      const segments = routeSegments(points);
      if (!segments.length) return;
      const route = L.layerGroup();
      for (const segment of segments) {
        L.polyline([segment.from, segment.to], {
          className: 'rf-packet-route', color: '#ff922b',
          dashArray: segment.approximate ? '7 7' : undefined,
          weight: 3, opacity: 0.9, interactive: false,
        }).addTo(route);
      }
      // Keep one recent route per source so other stations cannot erase it.
      const key = callsigns[0];
      const previous = routes.get(key);
      if (previous) { layers.removeLayer(previous); routes.delete(key); }
      if (routes.size >= 12) {
        const oldest = routes.keys().next().value!;
        layers.removeLayer(routes.get(oldest)!);
        routes.delete(oldest);
      }
      route.addTo(layers);
      routes.set(key, route);
      schedule(() => {
        layers.removeLayer(route);
        if (routes.get(key) === route) routes.delete(key);
      }, 10_000);
    }, 150);
  });
  return {
    setVisible(value: boolean) { visible = value; if (!value) { layers.clearLayers(); routes.clear(); } },
    dispose() { unsubscribe(); for (const timer of timers) clearTimeout(timer); timers.clear(); routes.clear(); layers.remove(); },
  };
}

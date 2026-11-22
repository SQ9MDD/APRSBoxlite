import { escapeHtml } from './escapeHtml';
import { renderPacketRows } from './PacketScroller';
import type { Station } from '../types';
import type { TrafficMonitorFrame } from '../views/TrafficMonitorView';
import type { Coordinates } from './LocationPicker';

interface RightPanelProps {
  station: Station | undefined;
  latestPacket: TrafficMonitorFrame | undefined;
  stations: Station[];
  showLatestPacket: boolean;
  showStations: boolean;
  frames: TrafficMonitorFrame[];
  ownCallsign: string;
  ownPosition: Coordinates | undefined;
}

export function createRightPanel({
  station,
  latestPacket,
  stations,
  showLatestPacket,
  showStations,
  frames,
  ownCallsign,
  ownPosition,
}: RightPanelProps): string {
  const details = renderScrollerStation(station);
  const latest = showLatestPacket
    ? renderLastPacket(latestPacket, stations, ownPosition)
    : '';
  const scroller = showStations
    ? `<section class="station-panel"><div class="drawer-header"><span>Traffic Monitor</span><button data-action="close-scroller" type="button" aria-label="Hide traffic scroller">×</button></div><div class="station-scroll">${details}<div class="packet-scroller">${renderPacketRows(frames, stations, ownCallsign)}</div></div></section>`
    : '';
  return `<aside class="right-panel">${latest}${scroller}</aside>`;
}

export function renderScrollerStation(station: Station | undefined): string {
  return station
    ? `<section class="station-card"><div class="panel-heading"><span>${station.callsign}</span><span class="station-symbol kind-${station.kind}">${escapeHtml(station.symbol)}</span></div><dl class="station-details"><div><dt>Heard</dt><dd>${station.lastHeard}</dd></div><div><dt>Position</dt><dd>${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)}</dd></div>${station.course ? `<div><dt>Course</dt><dd>${station.course} · ${station.speed}</dd></div>` : ''}</dl><p class="station-comment">${escapeHtml(station.comment)}</p></section>`
    : '';
}

export function renderLastPacket(
  frame: TrafficMonitorFrame | undefined,
  stations: Station[],
  ownPosition: Coordinates | undefined,
): string {
  const outer = frame?.packet.match(/^\s*([^>]+)>[^:]*:(.*)$/s);
  const inner = outer?.[2].startsWith('}')
    ? outer[2].slice(1).match(/^\s*([^>]+)>[^:]*:/)
    : undefined;
  const callsign = (inner?.[1] ?? outer?.[1])?.trim().toUpperCase();
  const station = callsign
    ? stations.find((item) => item.callsign === callsign.replace(/-0$/, ''))
    : frame
      ? undefined
      : stations[0];
  const displayCallsign = callsign ?? station?.callsign;
  if (!displayCallsign)
    return '<section class="last-heard-packet"><span>No decoded APRS stations available yet.</span></section>';
  const comment = station?.comment.trim() || '-';
  const qsyData = station?.decoded?.qsy;
  const qsy = qsyData
    ? [
        `${qsyData.frequencyMHz.toFixed(3)} MHz`,
        qsyData.tone,
        qsyData.offsetKHz !== undefined
          ? `${qsyData.offsetKHz > 0 ? '+' : ''}${qsyData.offsetKHz} kHz`
          : undefined,
      ]
        .filter(Boolean)
        .join(' ')
    : '-';
  let distance = '-';
  if (ownPosition && station) {
    const radians = Math.PI / 180;
    const lat1 = ownPosition.latitude * radians;
    const lat2 = station.latitude * radians;
    const dLat = lat2 - lat1;
    const dLon = (station.longitude - ownPosition.longitude) * radians;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const km =
      6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    const bearing =
      (Math.atan2(
        Math.sin(dLon) * Math.cos(lat2),
        Math.cos(lat1) * Math.sin(lat2) -
          Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
      ) /
        radians +
        360) %
      360;
    distance = `${km.toFixed(1)} km, ${Math.round(bearing) % 360}°`;
  }
  return `<section class="last-heard-packet"><h3>Latest packet</h3><dl><dt>Callsign</dt><dd class="last-packet-emphasis">${escapeHtml(displayCallsign)}</dd><dt>QSY</dt><dd class="last-packet-emphasis">${escapeHtml(qsy)}</dd><dt>Distance and azimuth</dt><dd>${escapeHtml(distance)}</dd><dt>Comment</dt><dd>${escapeHtml(comment)}</dd></dl></section>`;
}

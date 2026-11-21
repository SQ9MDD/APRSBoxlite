import type { Packet, Station } from '../types';

interface RightPanelProps {
  station: Station | undefined;
  latestPacket: Packet;
  stations: Station[];
  showLatestPacket: boolean;
}

export function createRightPanel({
  station,
  latestPacket,
  stations,
  showLatestPacket,
}: RightPanelProps): string {
  const details = station
    ? `<section class="station-card"><div class="panel-heading"><span>${station.callsign}</span><span class="station-symbol kind-${station.kind}">${station.symbol}</span></div><dl class="station-details"><div><dt>Heard</dt><dd>${station.lastHeard}</dd></div><div><dt>Position</dt><dd>${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)}</dd></div>${station.course ? `<div><dt>Course</dt><dd>${station.course} · ${station.speed}</dd></div>` : ''}</dl><p class="station-comment">${station.comment}</p></section>`
    : '';
  const latest = showLatestPacket
    ? `<p class="latest-line"><span class="pulse-dot"></span>${latestPacket.source} · ${latestPacket.type} · ${latestPacket.receivedAt}</p>`
    : '';
  return `<aside class="right-panel"><div class="drawer-header"><span>Stations <small>${stations.length}</small></span><button data-tool="scroller" type="button" aria-label="Hide station list">×</button></div>${latest}${details}<div class="recent-stations">${stations.map((item) => `<button class="recent-station ${item.callsign === station?.callsign ? 'is-selected' : ''}" data-station="${item.callsign}" type="button"><span class="station-symbol kind-${item.kind}">${item.symbol}</span><span><strong>${item.callsign}</strong><small>${item.name}</small></span><time>${item.lastHeard}</time></button>`).join('')}</div></aside>`;
}

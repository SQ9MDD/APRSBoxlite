import type { Station } from '../types';

export function renderStationsView(stations: Station[]): { html: string } {
  return {
    html: `<div class="standard-view"><div class="view-heading"><div><span class="eyebrow">Station directory</span><h2>Recently heard stations</h2><p>Stations heard during the selected time range.</p></div><div class="view-stat"><strong>${stations.length}</strong><span>active stations</span></div></div><div class="data-table"><div class="table-row table-header"><span>Callsign</span><span>Type</span><span>Comment</span><span>Last heard</span></div>${stations.map((station) => `<button class="table-row" data-station="${station.callsign}" type="button"><span><b>${station.callsign}</b><small>${station.name}</small></span><span class="type-pill ${station.kind}">${station.kind}</span><span>${station.comment}</span><time>${station.lastHeard}</time></button>`).join('')}</div></div>`,
  };
}

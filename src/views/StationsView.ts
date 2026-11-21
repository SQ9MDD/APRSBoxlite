import { escapeHtml } from '../components/escapeHtml';
import type { Station } from '../types';
import type { Coordinates } from '../components/LocationPicker';
import { stationFields } from './stationFields';

export function renderStationDetails(
  station: Station,
  ownPosition?: Coordinates,
): { html: string } {
  const fields = stationFields(station, ownPosition);
  return {
    html: `<div class="standard-view"><div class="view-heading"><div><span class="eyebrow">Station details</span><h2>${escapeHtml(station.callsign)}</h2></div><button class="outline-button" data-action="stations-back" type="button">Back to stations</button></div><section class="station-card station-details-page"><dl class="station-details">${fields
      .filter(([, value]) => value)
      .map(
        ([label, value]) =>
          `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? '')}</dd></div>`,
      )
      .join('')}</dl></section></div>`,
  };
}

export function renderStationsView(stations: Station[]): { html: string } {
  return {
    html: `<div class="standard-view"><div class="view-heading"><div><span class="eyebrow">Station directory</span><h2>Recently heard stations</h2><p>Stations heard during the selected time range.</p></div><div class="view-stat"><strong>${stations.length}</strong><span>active stations</span></div></div><div class="data-table"><div class="table-row table-header"><span>Callsign</span><span>Type</span><span>Comment</span><span>Last heard</span></div>${stations.map((station) => `<button class="table-row" data-station="${station.callsign}" type="button"><span><b>${station.callsign}</b><small>${station.name}</small></span><span class="type-pill ${station.kind}">${station.kind}</span><span>${escapeHtml(station.comment)}</span><time>${station.lastHeard}</time></button>`).join('')}</div></div>`,
  };
}

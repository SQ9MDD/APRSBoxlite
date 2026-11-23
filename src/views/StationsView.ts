import { escapeHtml } from '../components/escapeHtml';
import type { Station } from '../types';
import type { Coordinates } from '../components/LocationPicker';
import { stationDistanceKm, stationFields } from './stationFields';
import allIcon from '../components/icons/account-group-outline.svg';
import directIcon from '../components/icons/antenna.svg';
import mobileIcon from '../components/icons/car-outline.svg';
import fixedIcon from '../components/icons/home-outline.svg';
import objectIcon from '../components/icons/crosshairs.svg';
import weatherIcon from '../components/icons/weather-partly-cloudy.svg';
import messageIcon from '../components/icons/forum.svg';
import type { TrafficMonitorFrame } from './TrafficMonitorView';
import { filterStations, matchesStationFilter } from './stationSearch';
import { decodeAprsPosition, unwrapAprsPacket } from '../main/aprsPosition';
import type { StationFilter } from './stationSearch';
export type { StationFilter } from './stationSearch';

const symbols = import.meta.glob('../components/icons/aprs-symbols/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

export type StationSort = 'callsign' | 'lastHeard' | 'distance';
export interface StationsViewState {
  filter: StationFilter;
  sort: StationSort;
  direction: 'asc' | 'desc';
  search: string;
}

const filters: Array<{ id: StationFilter; label: string; icon: string; caption?: string }> = [
  { id: 'all', label: 'All stations', icon: allIcon },
  { id: 'direct', label: 'Heard direct on RF in the last 60 minutes', caption: 'Heard direct', icon: directIcon },
  { id: 'mobile', label: 'Mobile stations', icon: mobileIcon },
  { id: 'fixed', label: 'Fixed stations', icon: fixedIcon },
  { id: 'object', label: 'APRS objects and items', caption: 'Objects', icon: objectIcon },
  { id: 'weather', label: 'Weather stations', icon: weatherIcon },
];

function symbolHtml(symbol: string): string {
  const [table, code] = symbol;
  const index = (code?.charCodeAt(0) ?? 0) - 33;
  const icon = symbols[`../components/icons/aprs-symbols/${table === '/' ? '' : 'a'}${String(index).padStart(2, '0')}.png`] ?? symbols['../components/icons/aprs-symbols/x.png'];
  if (!icon) return '–';
  const overlay = table && /^[A-Z0-9]$/.test(table) ? `<span>${escapeHtml(table)}</span>` : '';
  return `<span class="stations-symbol"><img src="${escapeHtml(icon)}" alt="${escapeHtml(symbol)}">${overlay}</span>`;
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return '';
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

export function renderStationFilters(stations: Station[], filter: StationFilter): string {
  return filters.map(({ id, label, icon, caption }) => `<button type="button" class="stations-filter${filter === id ? ' is-active' : ''}" data-stations-filter="${id}" title="${label}" aria-label="${label}" aria-pressed="${filter === id}"><img src="${icon}" alt="">${caption ? `<span class="stations-filter-caption">${caption}</span>` : ''}<strong>${stations.filter((station) => matchesStationFilter(station, id)).length}</strong></button>`).join('');
}

export function renderStationSearch(stations: Station[], state: StationsViewState): string {
  const count = filterStations(stations, state.filter, state.search).length;
  return `<div class="traffic-filter-bar stations-search"><input type="search" data-stations-search value="${escapeHtml(state.search)}" placeholder="Filter stations" aria-label="Filter stations" autocomplete="off" spellcheck="false"><button class="outline-button" type="button" data-action="clear-stations-search" ${state.search.trim() ? '' : 'disabled'}>Clear filter</button><span data-stations-count>${count} entries</span></div>`;
}

export function renderStationDetails(station: Station, ownPosition: Coordinates | undefined, frames: TrafficMonitorFrame[], stations: Station[]): { html: string } {
  const deviceLabels = ['APRS client', 'TOCALL', 'Mic-E', 'Vendor', 'Model', 'Class', 'Class description', 'OS', 'Capabilities'];
  const fields = stationFields(station, ownPosition).filter(([label]) => !deviceLabels.includes(label));
  const device = station.aprsDevice;
  const deviceFields: Array<[string, string | undefined]> = device ? [
    [device.identifierKind === 'tocall' ? 'TOCALL' : 'Mic-E', device.actualIdentifier],
    ['Identified software/device', device.identifiedAs],
    ['Vendor', device.vendor], ['Model', device.model], ['Class', device.classLabel],
    ['Class description', device.classDescription], ['OS', device.os],
    ['Capabilities', device.features.join(', ')],
  ] : [];
  const devicePanel = device ? `<div class="station-detail-device"><h2>APRS device identification</h2><strong>${escapeHtml(device.identifiedAs)}</strong><dl class="station-detail-fields">${deviceFields.filter(([, value]) => value).map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value!)}</dd>`).join('')}</dl></div>` : '';
  const cutoff = Date.now() - 60 * 60 * 1000;
  const packets = frames.filter((frame) => {
    const packet = unwrapAprsPacket(frame.packet);
    const source = packet?.match(/^\s*([^>]+)>/);
    const position = station.entityType ? decodeAprsPosition(frame.packet) : undefined;
    return Date.parse(frame.receivedAt) > cutoff && (station.entityType ? position?.entityType === station.entityType && position.callsign === station.callsign : source?.[1].trim().toUpperCase().replace(/-0$/, '') === station.callsign);
  });
  const base = station.callsign.split('-')[0];
  const related = station.entityType ? [] : stations.filter((item) => !item.entityType && item.callsign.split('-')[0] === base).sort((a, b) => a.callsign.localeCompare(b.callsign, undefined, { numeric: true }));
  const packetRows = packets.map((frame) => {
    const destination = frame.packet.match(/^[^>]+>([^,:]+)/)?.[1] ?? '–';
    return `<tr><td><time>${escapeHtml(new Date(frame.receivedAt).toLocaleString())}</time><small>${relativeTime(frame.receivedAt)}</small></td><td>${escapeHtml(destination)}</td><td><code>${escapeHtml(frame.packet)}</code></td></tr>`;
  }).join('');
  const meta = [`Last activity ${new Date(station.lastHeard).toLocaleString()} (${relativeTime(station.lastHeard)})`, station.sourceInterface && `Source ${station.sourceInterface}`, station.path && `Path ${station.path}`].filter(Boolean).map((value) => escapeHtml(value!)).join(' · ');
  return {
    html: `<div class="station-detail-view"><section class="station-detail-panel station-detail-header"><div><h2>${escapeHtml(station.callsign)}</h2><p>${meta}</p></div><div class="station-detail-actions"><button class="outline-button" data-action="stations-back" type="button">Back to stations</button><button class="theme-toggle" data-action="station-message" type="button" title="Open in Messages" aria-label="Open conversation with ${escapeHtml(station.callsign)}"><img src="${messageIcon}" alt=""></button></div></section><div class="station-detail-hero"><section class="station-detail-panel"><h2>Station Details</h2><dl class="station-detail-fields">${fields.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}${packets[0] ? `<dt>Latest raw packet</dt><dd><code>${escapeHtml(packets[0].packet)}</code></dd>` : ''}</dl></section><section class="station-detail-panel"><h2>Station Map</h2><div class="station-detail-map" aria-label="Station detail map"></div>${devicePanel}</section></div><section class="station-detail-panel"><h2>Recent Packets / Frames</h2>${packetRows ? `<div class="station-detail-packets"><table class="stations-table"><thead><tr><th>Timestamp</th><th>Destination</th><th>Raw packet</th></tr></thead><tbody>${packetRows}</tbody></table></div>` : '<p class="station-detail-muted">No packet history is available for this station yet.</p>'}</section><section class="station-detail-panel"><h2>Other Known SSIDs</h2>${related.length > 1 ? `<div class="station-detail-ssids">${related.map((item) => `<button type="button" data-station="${escapeHtml(item.callsign)}" class="${item.callsign === station.callsign ? 'is-current' : ''}">${escapeHtml(item.callsign)}${item.callsign === station.callsign ? ' · current' : ''}</button>`).join('')}</div>` : `<p class="station-detail-muted">No other known SSIDs are currently available for ${escapeHtml(base)}.</p>`}</section></div>`,
  };
}

export function renderStationsView(stations: Station[], ownPosition: Coordinates | undefined, state: StationsViewState): { html: string } {
  const selected = filterStations(stations, state.filter, state.search);
  selected.sort((a, b) => {
    let order: number;
    if (state.sort === 'callsign') order = a.callsign.localeCompare(b.callsign, undefined, { numeric: true, sensitivity: 'base' });
    else if (state.sort === 'distance') {
      const left = stationDistanceKm(a, ownPosition);
      const right = stationDistanceKm(b, ownPosition);
      if (left === undefined || right === undefined) return left === right ? a.callsign.localeCompare(b.callsign) : left === undefined ? 1 : -1;
      order = left - right;
    } else order = a.lastHeard.localeCompare(b.lastHeard);
    return (state.direction === 'asc' ? order : -order) || a.callsign.localeCompare(b.callsign);
  });
  const sortHeader = (key: StationSort, label: string) => {
    const active = state.sort === key;
    const indicator = active ? (state.direction === 'asc' ? '↑' : '↓') : '↕';
    return `<th aria-sort="${active ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-stations-sort="${key}">${label} ${indicator}</button></th>`;
  };
  const rows = selected.map((station) => {
    const distance = stationDistanceKm(station, ownPosition);
    const data = stationFields(station).filter(([label]) => ['Course', 'Speed', 'Altitude', 'PHG', 'QSY', 'Temperature', 'Humidity', 'Pressure', 'Wind', 'Wind gust'].includes(label));
    return `<tr data-station="${escapeHtml(station.callsign)}" tabindex="0" role="button" aria-label="Station details: ${escapeHtml(station.callsign)}"><td><strong>${escapeHtml(station.callsign)}</strong>${station.aprsClient ? `<small>${escapeHtml(station.aprsClient)}</small>` : ''}</td><td><span class="type-pill ${station.kind}">${escapeHtml(station.kind)}</span></td><td><time datetime="${escapeHtml(station.lastHeard)}">${escapeHtml(new Date(station.lastHeard).toLocaleString())}</time><small>${relativeTime(station.lastHeard)}</small></td><td>${symbolHtml(station.symbol)}</td><td>${station.latitude.toFixed(5)}</td><td>${station.longitude.toFixed(5)}</td><td>${distance === undefined ? '–' : `${distance.toFixed(1)} km`}</td><td><div class="stations-data">${data.length ? data.map(([label, value]) => `<span title="${escapeHtml(label)}">${escapeHtml(value)}</span>`).join('') : '–'}</div></td><td class="stations-comment">${escapeHtml(station.comment || '–')}</td></tr>`;
  }).join('');
  return { html: `<div class="standard-view stations-view"><div class="stations-table-wrap"><table class="stations-table"><thead><tr>${sortHeader('callsign', 'Callsign')}<th>Type</th>${sortHeader('lastHeard', 'Last activity')}<th>APRS icon</th><th>Lat.</th><th>Lon.</th>${sortHeader('distance', 'Distance')}<th>Data</th><th>Comment</th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="stations-empty">${state.search.trim() ? 'No matching stations.' : 'No decoded APRS stations available.'}</td></tr>`}</tbody></table></div></div>` };
}

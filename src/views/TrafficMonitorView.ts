import { filterTrafficFrames } from '../trafficLog';
export { filterTrafficFrames } from '../trafficLog';

export interface TrafficMonitorFrame {
  id: string;
  receivedAt: string;
  interfaceId: string;
  interfaceName: string;
  packet: string;
  source: 'kiss';
  direction: 'rx' | 'tx';
  category?: 'own-beacon' | 'own-weather' | 'own-message';
}

function formatTimestamp(value: string): { date: string; time: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: 'UTC' };
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ];
  return {
    date: parts.join('.'),
    time: `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')} UTC`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] ?? character,
  );
}

export function renderTrafficEntries(frames: TrafficMonitorFrame[], filter: string): string {
  const matching = filterTrafficFrames(frames, filter);
  return matching.length
    ? matching
        .map((frame) =>
          (() => {
            const timestamp = formatTimestamp(frame.receivedAt);
            return `<article class="traffic-entry${frame.category ? ` traffic-${frame.category}-${frame.direction}` : ''}"><time class="traffic-date">${timestamp.date}</time><time class="traffic-time">${timestamp.time}</time><span class="traffic-separator" aria-hidden="true">·</span><span class="traffic-interface">${escapeHtml(frame.interfaceName)}</span><span class="traffic-separator" aria-hidden="true">·</span><b class="traffic-direction">${frame.direction.toUpperCase()}</b><code>${escapeHtml(frame.packet)}</code></article>`;
          })(),
        )
        .join('')
    : `<p class="traffic-empty">${filter.trim() ? 'No matching frames.' : 'No received KISS frames in the last 60 minutes.'}</p>`;
}

export function renderTrafficMonitorView(frames: TrafficMonitorFrame[], legendOpen: boolean, filter: string): {
  html: string;
} {
  const entries = renderTrafficEntries(frames, filter);
  return {
    html: `<div class="traffic-monitor" aria-label="Traffic monitor"><div class="traffic-table">${entries}</div></div>${legendOpen ? `<div class="traffic-legend-backdrop" data-action="close-traffic-legend"><section class="traffic-legend" role="dialog" aria-modal="true" aria-labelledby="traffic-legend-title"><div class="traffic-legend-heading"><h2 id="traffic-legend-title">Traffic colors</h2><button type="button" data-action="close-traffic-legend" aria-label="Close">×</button></div><div class="traffic-legend-items">${(['beacon', 'weather', 'message'] as const).flatMap((kind) => (['tx', 'rx'] as const).map((direction) => `<span><i class="traffic-own-${kind}-${direction}"></i>Own ${kind}${direction === 'rx' ? ' echo' : ''} ${direction.toUpperCase()}</span>`)).join('')}</div></section></div>` : ''}`,
  };
}

export function renderTrafficFilter(frames: TrafficMonitorFrame[], filter: string): string {
  const count = filterTrafficFrames(frames, filter).length;
  return `<div class="traffic-filter-bar"><input type="search" data-traffic-filter value="${escapeHtml(filter)}" placeholder="Filter traffic" aria-label="Filter traffic" autocomplete="off" spellcheck="false" maxlength="1024"><button class="outline-button" type="button" data-action="clear-traffic-filter" ${filter.trim() ? '' : 'disabled'}>Clear filter</button><span data-traffic-count>${count} entries</span></div>`;
}


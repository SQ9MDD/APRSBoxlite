import { escapeHtml } from './escapeHtml';
import type { Station } from '../types';
import type { TrafficMonitorFrame } from '../views/TrafficMonitorView';

const icons = import.meta.glob('./icons/aprs-symbols/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function parseFrame(packet: string, ownCallsign: string) {
  const parse = (line: string) =>
    line.match(/^\s*([^>]+)>\s*([^,:]+)(?:,([^:]*))?:(.*)$/s);
  const outer = parse(packet);
  if (!outer) return undefined;
  const thirdParty = outer[4].startsWith('}');
  const inner = thirdParty ? parse(outer[4].slice(1).trimStart()) : undefined;
  const callsign = (inner?.[1] ?? outer[1]).trim().toUpperCase();
  const path = (outer[3] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const starred = path
    .map((hop, index) => (hop.endsWith('*') ? index : -1))
    .filter((index) => index >= 0);
  const used =
    starred.length === 1
      ? path.slice(0, starred[0] + 1)
      : path.filter((hop) => hop.endsWith('*'));
  const cleaned = used.map((hop) => hop.replace(/\*$/, '').toUpperCase());
  const own = ownCallsign.toUpperCase().split('-')[0];
  const viaOwn = own && cleaned.some((hop) => hop.split('-')[0] === own);
  const specific = cleaned.filter(
    (hop) =>
      !/^(?:(?:WIDE|TRACE|RELAY|GATE)\d*(?:-\d+)?|[A-Z]{1,5}\d(?:-\d+)?|TCPIP|TCPXX|RFONLY|NOGATE|NORF|Q[A-Z].*)$/.test(
        hop,
      ),
  );
  const last = thirdParty
    ? outer[1].trim().toUpperCase()
    : (specific.at(-1) ?? cleaned.at(-1));
  const digi = last ? `${last.replace(/-0$/, '')}*` : '-';
  const marker = viaOwn
    ? '@'
    : thirdParty
      ? '#'
      : cleaned.length === 0
        ? '*'
        : '';
  return { callsign, digi, marker };
}

function symbolIcon(symbol: string | undefined) {
  const table = symbol?.[0];
  const code = symbol?.[1];
  const index = (code?.charCodeAt(0) ?? 0) - 33;
  const path = (name: string) =>
    icons[`./icons/aprs-symbols/${name}.png`];
  return {
    src:
      (index >= 0 && index <= 93
        ? path(`${table === '/' ? '' : 'a'}${String(index).padStart(2, '0')}`)
        : undefined) ?? path('x'),
    overlay: table && /^[A-Z0-9]$/.test(table) ? table : '',
  };
}

export function renderPacketRows(
  frames: TrafficMonitorFrame[],
  stations: Station[],
  ownCallsign: string,
): string {
  const byCallsign = new Map(
    stations.map((station) => [station.callsign.toUpperCase(), station]),
  );
  const cutoff = Date.now() - 60 * 60 * 1000;
  const rows: string[] = [];
  for (const frame of frames) {
    if (frame.direction !== 'rx') continue;
    if (Date.parse(frame.receivedAt) <= cutoff) continue;
    const parsed = parseFrame(frame.packet, ownCallsign);
    if (!parsed) continue;
    const station = byCallsign.get(parsed.callsign.replace(/-0$/, ''));
    const icon = symbolIcon(station?.symbol);
    const timestamp = new Date(frame.receivedAt).toLocaleTimeString();
    const attributes = station
      ? ` data-station="${escapeHtml(station.callsign)}" title="${escapeHtml(timestamp)}"`
      : ` title="${escapeHtml(timestamp)}"`;
    rows.push(
      `<button class="packet-scroller-row" type="button"${attributes} ${station ? '' : 'disabled'}><span class="packet-scroller-icon"><img src="${escapeHtml(icon.src)}" alt="">${icon.overlay ? `<span>${escapeHtml(icon.overlay)}</span>` : ''}</span><span class="packet-scroller-callsign">${escapeHtml(parsed.callsign + parsed.marker)}</span><span class="packet-scroller-digi">${escapeHtml(parsed.digi)}</span></button>`,
    );
    if (rows.length === 120) break;
  }
  return rows.length
    ? rows.join('')
    : '<p class="packet-scroller-empty">No frames received yet.</p>';
}

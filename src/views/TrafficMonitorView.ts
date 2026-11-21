export interface TrafficMonitorFrame {
  id: string;
  receivedAt: string;
  interfaceId: string;
  interfaceName: string;
  packet: string;
  source: 'kiss';
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

export function renderTrafficMonitorView(frames: TrafficMonitorFrame[]): {
  html: string;
} {
  const entries = frames.length
    ? frames
        .map((frame) =>
          (() => {
            const timestamp = formatTimestamp(frame.receivedAt);
            return `<article class="traffic-entry"><time class="traffic-date">${timestamp.date}</time><time class="traffic-time">${timestamp.time}</time><span class="traffic-separator" aria-hidden="true">·</span><span class="traffic-interface">${escapeHtml(frame.interfaceName)}</span><span class="traffic-separator" aria-hidden="true">·</span><b class="traffic-direction">RX</b><code>${escapeHtml(frame.packet)}</code></article>`;
          })(),
        )
        .join('')
    : `<p class="traffic-empty">No received KISS TCP frames in the last 60 minutes.</p>`;
  return {
    html: `<div class="traffic-monitor" aria-label="Traffic monitor"><div class="traffic-table">${entries}</div></div>`,
  };
}

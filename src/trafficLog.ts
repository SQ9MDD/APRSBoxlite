export interface TrafficLogFrame {
  receivedAt: string;
  interfaceName: string;
  packet: string;
  source: string;
  direction: 'rx' | 'tx';
}

export function filterTrafficFrames<T extends TrafficLogFrame>(frames: T[], filter: string): T[] {
  const query = filter.trim().toLowerCase();
  return query ? frames.filter((frame) => [frame.interfaceName, frame.source, frame.direction, frame.packet].join(' ').toLowerCase().includes(query)) : frames;
}

export function formatTrafficLog(frames: TrafficLogFrame[]): string {
  return frames.map((frame) => {
    const date = new Date(frame.receivedAt);
    const timestamp = Number.isNaN(date.getTime()) ? frame.receivedAt : `${date.toISOString().slice(0, 10).replaceAll('-', '.')} ${date.toISOString().slice(11, 19)} UTC`;
    return `${timestamp} ${frame.interfaceName} ${frame.direction.toUpperCase()} ${frame.packet}`;
  }).join('\n') + (frames.length ? '\n' : '');
}

export function trafficLogFilename(callsign: string, date: Date): string {
  const identity = callsign.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'APRSBOX';
  const two = (value: number) => String(value).padStart(2, '0');
  return `${identity}-${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}-log.txt`;
}

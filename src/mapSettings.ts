export interface MapSource {
  id: string;
  name: string;
  url: string;
  attribution: string;
  minZoom: number;
  maxZoom: number;
  enabled: boolean;
  cacheEnabled?: boolean;
}
export interface MapSettings {
  coverageFillOpacity: number;
  stationLabelHideAtZoom: number;
  sources: MapSource[];
  defaultSourceId: string;
}
export const DEFAULT_MAP_SETTINGS: MapSettings = {
  coverageFillOpacity: 5,
  stationLabelHideAtZoom: 10,
  sources: [{ id: 'osm', name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', minZoom: 0, maxZoom: 19, enabled: true }],
  defaultSourceId: 'osm',
};

export function validateMapSettings(value: unknown): MapSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map settings.');
  const data = value as Record<string, unknown>;
  const stationLabelHideAtZoom = data.stationLabelHideAtZoom === undefined
    ? DEFAULT_MAP_SETTINGS.stationLabelHideAtZoom
    : data.stationLabelHideAtZoom;
  if (typeof stationLabelHideAtZoom !== 'number' || !Number.isInteger(stationLabelHideAtZoom) || stationLabelHideAtZoom < 0 || stationLabelHideAtZoom > 19) throw new Error('Station label zoom must be an integer between 0 and 19.');
  if (!Number.isInteger(data.coverageFillOpacity) || Number(data.coverageFillOpacity) < 0 || Number(data.coverageFillOpacity) > 20) throw new Error('Coverage opacity must be between 0 and 20%.');
  if (!Array.isArray(data.sources) || data.sources.length < 1 || data.sources.length > 32) throw new Error('Configure between 1 and 32 map sources.');
  const ids = new Set<string>();
  const sources = data.sources.map((raw): MapSource => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid map source.');
    const source = raw as Record<string, unknown>;
    const text = (key: string, max: number) => {
      if (typeof source[key] !== 'string' || (source[key] as string).length > max) throw new Error(`Invalid map source ${key}.`);
      return (source[key] as string).trim();
    };
    const id = text('id', 80);
    const name = text('name', 100);
    const url = text('url', 2048);
    const attribution = text('attribution', 500);
    if (!id || !name || ids.has(id)) throw new Error('Map sources need a name and unique ID.');
    ids.add(id);
    if (!['{z}', '{x}', '{y}'].every((token) => url.includes(token))) throw new Error('The URL must include {z}, {x} and {y}.');
    let parsed: URL;
    try { parsed = new URL(url.replace(/\{[zxys]\}/g, '0')); } catch { throw new Error('Invalid map source URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || /\{(?![zxys]\})/.test(url)) throw new Error('Map source URL must use HTTP or HTTPS and supported tile placeholders.');
    const minZoom = source.minZoom;
    const maxZoom = source.maxZoom;
    if (typeof minZoom !== 'number' || typeof maxZoom !== 'number' || !Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom < 0 || minZoom > 19 || maxZoom > 30 || minZoom > maxZoom) throw new Error('Invalid map source zoom range (minimum zoom must be 0–19).');
    if (typeof source.enabled !== 'boolean') throw new Error('Invalid map source state.');
    if (source.cacheEnabled !== undefined && typeof source.cacheEnabled !== 'boolean') throw new Error('Invalid map cache state.');
    return { id, name, url, attribution, minZoom, maxZoom, enabled: source.enabled, cacheEnabled: source.cacheEnabled === true };
  });
  if (typeof data.defaultSourceId !== 'string' || !sources.some((item) => item.id === data.defaultSourceId && item.enabled)) throw new Error('Select an enabled default map source.');
  return { coverageFillOpacity: Number(data.coverageFillOpacity), stationLabelHideAtZoom, sources, defaultSourceId: data.defaultSourceId };
}

export function mapTileUrl(source: MapSource): string {
  return source.cacheEnabled
    ? `aprsbox-tile://tiles/${encodeURIComponent(source.id)}/{z}/{x}/{y}`
    : source.url;
}

export function activeMapSource(settings: MapSettings): MapSource {
  return settings.sources.find((item) => item.id === settings.defaultSourceId && item.enabled) ?? DEFAULT_MAP_SETTINGS.sources[0];
}

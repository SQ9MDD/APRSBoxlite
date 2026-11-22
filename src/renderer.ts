import './index.css';
import { createAlertDialog } from './components/AlertDialog';
import type { AlertMessage } from './components/AlertDialog';
import { createConfirmDialog } from './components/ConfirmDialog';
import type { Confirmation } from './components/ConfirmDialog';
import {
  createLocationPicker,
  formatCoordinates,
  mountLocationPicker,
} from './components/LocationPicker';
import type {
  Coordinates,
  MountedLocationPicker,
} from './components/LocationPicker';
import { createSidebar } from './components/Sidebar';
import { createTopbar, renderInterfaceStatusDots } from './components/Topbar';
import type { MapToolId, MapToolState, ThemeMode } from './components/Topbar';
import { createRightPanel, renderLastPacket, renderScrollerStation } from './components/RightPanel';
import { renderPacketRows } from './components/PacketScroller';
import { renderMapView } from './views/MapView';
import type { MapViewport } from './views/MapView';
import type { RulerState } from './views/MapRuler';
import { renderMessageHistory, renderMessagesView } from './views/MessagesView';
import {
  renderSettingsView,
  type PhgValues,
  type InterfaceSettings,
  type SettingsSection,
  type StationSettings,
} from './views/SettingsView';
import { renderStationDetails, renderStationFilters, renderStationSearch, renderStationsView } from './views/StationsView';
import { filterStations } from './views/stationSearch';
import { mountStationDetailMap } from './views/StationDetailMap';
import type { StationFilter, StationSort, StationsViewState } from './views/StationsView';
import { filterTrafficFrames, renderTrafficEntries, renderTrafficFilter, renderTrafficMonitorView } from './views/TrafficMonitorView';
import type { TrafficMonitorFrame } from './views/TrafficMonitorView';
import type { AppView, Station, AprsMessage } from './types';
import { activeMapSource, DEFAULT_MAP_SETTINGS, validateMapSettings } from './mapSettings';
import type { MapSettings, MapSource } from './mapSettings';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) throw new Error('Could not find the app root element.');

const appRoot = root;

let activeView: AppView = 'map';
let selectedCallsign: string | undefined;
let detailCallsign: string | undefined;
const stationsViewState: StationsViewState = { filter: 'all', sort: 'lastHeard', direction: 'desc', search: '' };
let messageRecipient: string | undefined;
let messages: AprsMessage[] = [];
let liveStations: Station[] = [];
let updateStationMarkers: ((stations: Station[]) => void) | undefined;
let updateDetailMap: ((station: Station) => void) | undefined;
let mapViewport: MapViewport | undefined;
let mapSettings: MapSettings = structuredClone(DEFAULT_MAP_SETTINGS);
let mapSourceDraft: MapSource | undefined;
const rulerState: RulerState = { measurementActive: false };
let mountedView: AppView | undefined;
let activeSettingsSection: SettingsSection = 'general';
let selectedInterfaceId: string | undefined;
let interfaces: InterfaceSettings[] = [];
let interfaceDraft: InterfaceSettings = createInterfaceDraft();
let themeMode: ThemeMode = 'system';
let beaconSending = false;
let mapMaskOpacity = { light: 10, dark: 20 };
let stationSettings: StationSettings = {
  callsign: 'SQ9MDD',
  ssid: '-8',
  location: '50.0619, 19.9383',
  comment: 'APRSBox Lite station',
  status: 'Monitoring APRS traffic',
  beaconInterval: '15 minutes',
  statusInterval: '30 minutes',
  symbolTable: '/',
  symbolCode: '>',
  symbolOverlay: '',
  beaconPath: '',
  beaconInterfaceId: '',
};
let alertMessage: AlertMessage | undefined;
let confirmation: Confirmation | undefined;
let pendingInterfaceDeletion: InterfaceSettings | undefined;
let phgCalculatorOpen = false;
let locationAccuracy: string | undefined;
let locationPickerOpen = false;
let locationPickerCenter: Coordinates | undefined;
let mountedLocationPicker: MountedLocationPicker | undefined;
let trafficFrames: TrafficMonitorFrame[] = [];
let trafficLegendOpen = false;
let savingTrafficLog = false;
let trafficFilter = '';
let interfaceStatuses: Record<
  string,
  'connecting' | 'connected' | 'disconnected' | 'error'
> = {};
let phgValues: PhgValues = {
  power: '5',
  height: '3',
  gain: '2',
  direction: '0',
};
const mapTools: MapToolState = {
  tracks: true,
  coverage: true,
  packet: true,
  scroller: true,
  ruler: false,
  grid: false,
};
let scrollerVisibilityChanged = false;
let scrollerChangeRevision = 0;
let scrollerBeforeSleep: { visible: boolean; revision: number } | undefined;
let disposeCurrentView: (() => void) | undefined;

const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');

function createInterfaceDraft(): InterfaceSettings {
  return {
    id: '',
    name: '',
    type: 'kiss-tcp',
    enabled: true,
    txBlocked: false,
    hostPort: '127.0.0.1:8001',
    serialDevice: '',
    baudRate: '9600',
    reconnectTimeout: '150',
  };
}

function applyTheme(): void {
  const resolvedTheme =
    themeMode === 'system'
      ? colorScheme.matches
        ? 'dark'
        : 'light'
      : themeMode;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.setProperty(
    '--map-mask-opacity',
    String(mapMaskOpacity[resolvedTheme] / 100),
  );
}

function parseCoordinates(value: string): Coordinates | undefined {
  const match = value
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }
  return { latitude, longitude };
}

function requestFreshSystemLocation(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not available on this system.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve(coords),
      reject,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

function applySystemLocation(coords: GeolocationCoordinates): void {
  const coordinates = {
    latitude: coords.latitude,
    longitude: coords.longitude,
  };
  stationSettings.location = formatCoordinates(coordinates);
  locationAccuracy = `System location accuracy: ±${Math.round(coords.accuracy)} m`;
}

function applyStoredStationConfiguration(
  configuration: Record<string, unknown>,
): void {
  const station = configuration.station;
  if (
    typeof station !== 'object' ||
    station === null ||
    Array.isArray(station)
  ) {
    return;
  }
  const stored = station as Partial<StationSettings>;
  const keys: Array<keyof StationSettings> = [
    'callsign',
    'ssid',
    'location',
    'comment',
    'status',
    'beaconInterval',
    'statusInterval',
    'symbolTable',
    'symbolCode',
    'symbolOverlay',
    'beaconPath',
    'beaconInterfaceId',
  ];
  for (const key of keys) {
    if (typeof stored[key] === 'string') stationSettings[key] = stored[key];
  }
}

function applyStoredInterfaces(configuration: Record<string, unknown>): void {
  if (!Array.isArray(configuration.interfaces)) return;
  interfaces = configuration.interfaces.filter(isInterfaceSettings);
}

function isInterfaceSettings(value: unknown): value is InterfaceSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    (item.type === 'kiss-tcp' || item.type === 'kiss-serial') &&
    typeof item.enabled === 'boolean' &&
    typeof item.txBlocked === 'boolean' &&
    typeof item.hostPort === 'string' &&
    typeof item.serialDevice === 'string' &&
    typeof item.baudRate === 'string' &&
    typeof item.reconnectTimeout === 'string'
  );
}

async function saveMapSettings(value: MapSettings, clearDraft = false): Promise<void> {
  try {
    const validated = validateMapSettings(value);
    await window.aprsbox.config.saveMapSettings(validated);
    mapSettings = validated;
    if (clearDraft) mapSourceDraft = undefined;
    alertMessage = { title: 'Map settings saved', message: 'Map settings were saved.', tone: 'success' };
  } catch (error) {
    alertMessage = { title: 'Map settings not saved', message: error instanceof Error ? error.message : String(error), tone: 'error' };
  }
  renderApp();
}

const mapCacheStatsRequests = new Map<string, number>();
async function updateMapCacheStats(id: string): Promise<void> {
  const revision = (mapCacheStatsRequests.get(id) ?? 0) + 1;
  mapCacheStatsRequests.set(id, revision);
  const label = () => [...appRoot.querySelectorAll<HTMLElement>('[data-cache-count]')]
    .find((element) => element.dataset.cacheCount === id);
  try {
    const stats = await window.aprsbox.config.getMapCacheStats(id);
    if (mapCacheStatsRequests.get(id) !== revision) return;
    const target = label();
    if (target) target.textContent = `${stats.count} tiles · ${stats.bytes >= 1048576 ? `${(stats.bytes / 1048576).toFixed(1)} MB` : stats.bytes >= 1024 ? `${(stats.bytes / 1024).toFixed(1)} KB` : `${stats.bytes} B`}`;
  } catch {
    if (mapCacheStatsRequests.get(id) === revision) {
      const target = label();
      if (target) target.textContent = 'Cache unavailable';
    }
  }
}

async function loadConfiguration(): Promise<void> {
  try {
    const configuration = await window.aprsbox.config.get();
    if (configuration.mapSettings !== undefined) {
      try { mapSettings = validateMapSettings(configuration.mapSettings); } catch { /* Keep the default source if saved settings are invalid. */ }
    }
    if (!scrollerVisibilityChanged && typeof configuration.scrollerVisible === 'boolean')
      mapTools.scroller = configuration.scrollerVisible;
    const mask = configuration.mapMaskOpacity as
      | Record<string, unknown>
      | undefined;
    if (mask && typeof mask === 'object') {
      for (const theme of ['light', 'dark'] as const) {
        const value = mask[theme];
        if (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 100 &&
          value % 10 === 0
        )
          mapMaskOpacity[theme] = value;
      }
    }
    applyTheme();
    applyStoredStationConfiguration(configuration);
    applyStoredInterfaces(configuration);
    const viewport = configuration.mapViewport as
      | Partial<MapViewport>
      | undefined;
    if (
      viewport &&
      typeof viewport.latitude === 'number' &&
      Number.isFinite(viewport.latitude) &&
      Math.abs(viewport.latitude) <= 90 &&
      typeof viewport.longitude === 'number' &&
      Number.isFinite(viewport.longitude) &&
      typeof viewport.zoom === 'number' &&
      Number.isInteger(viewport.zoom) &&
      viewport.zoom >= 0 &&
      viewport.zoom <= 19
    ) {
      mapViewport = viewport as MapViewport;
    }
    renderApp();
  } catch {
    // The UI remains usable with its in-memory defaults if configuration is unavailable.
    renderApp();
  }
}

async function loadTraffic(): Promise<void> {
  try {
    const [recentFrames, statuses] = await Promise.all([
      window.aprsbox.traffic.getRecent(),
      window.aprsbox.traffic.getInterfaceStatuses(),
    ]);
    const framesById = new Map(
      [...trafficFrames, ...recentFrames].map((frame) => [frame.id, frame]),
    );
    trafficFrames = [...framesById.values()]
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
      .slice(0, 1000);
    interfaceStatuses = { ...statuses, ...interfaceStatuses };
    updateTopbarInterfaceStatuses();
    const packetBox = appRoot.querySelector('.last-heard-packet');
    if (packetBox)
      packetBox.outerHTML = renderLastPacket(
        trafficFrames.find((frame) => frame.direction === 'rx'),
        liveStations,
        parseCoordinates(stationSettings.location),
      );
    refreshPacketScroller();
    if (activeView === 'traffic') refreshTrafficMonitor();
    else if (activeView === 'settings') renderApp();
  } catch {
    // Traffic is live-only; an unavailable Main Process leaves the monitor empty.
  }
}

window.aprsbox.traffic.onReceived((frame) => {
  trafficFrames = [frame, ...trafficFrames].slice(0, 1_000);
  const packetBox = appRoot.querySelector('.last-heard-packet');
  if (packetBox && frame.direction === 'rx')
    packetBox.outerHTML = renderLastPacket(
      frame,
      liveStations,
      parseCoordinates(stationSettings.location),
    );
  refreshPacketScroller();
  if (activeView === 'traffic') refreshTrafficMonitor();
});

function refreshTrafficMonitor(): void {
  const table = appRoot.querySelector<HTMLElement>('.traffic-table');
  if (!table) return;
  const top = table.scrollTop;
  table.innerHTML = renderTrafficEntries(trafficFrames, trafficFilter);
  table.scrollTop = top;
  const count = appRoot.querySelector<HTMLElement>('[data-traffic-count]');
  if (count) count.textContent = `${filterTrafficFrames(trafficFrames, trafficFilter).length} entries`;
  const clear = appRoot.querySelector<HTMLButtonElement>('[data-action="clear-traffic-filter"]');
  if (clear) clear.disabled = !trafficFilter.trim();
}

window.aprsbox.traffic.onInterfaceStatus(({ interfaceId, status }) => {
  interfaceStatuses = { ...interfaceStatuses, [interfaceId]: status };
  updateTopbarInterfaceStatuses();
  if (activeView === 'settings' && activeSettingsSection !== 'general') renderApp();
  if (activeView === 'messages') {
    const option = [
      ...appRoot.querySelectorAll<HTMLOptionElement>(
        'select[name="interfaceId"] option',
      ),
    ].find((item) => item.value === interfaceId);
    const configured = interfaces.find((item) => item.id === interfaceId);
    if (option && configured) {
      option.disabled = status !== 'connected';
      option.textContent = `${configured.name || configured.hostPort || configured.serialDevice} · ${status}`;
    }
  }
});

function updateTopbarInterfaceStatuses(): void {
  const container = appRoot.querySelector<HTMLElement>('.topbar-interfaces');
  if (container) container.innerHTML = renderInterfaceStatusDots(interfaces, interfaceStatuses);
}

colorScheme.addEventListener('change', () => {
  if (themeMode === 'system') {
    applyTheme();
    renderApp();
  }
});

const pageRenderers: Record<
  AppView,
  () => { html: string; mount?: (element: HTMLElement) => () => void }
> = {
  map: () =>
    renderMapView({
      subscribeToStations: (update) => {
        updateStationMarkers = update;
        update(liveStations);
        return () => {
          updateStationMarkers = undefined;
        };
      },
      viewport: mapViewport,
      mapSettings,
      rulerState,
      ownPosition: () => parseCoordinates(stationSettings.location),
      onStationAction: (action, callsign) => {
        if (action === 'details') {
          detailCallsign = callsign;
          activeView = 'stations';
        } else {
          messageRecipient = callsign;
          activeView = 'messages';
        }
        renderApp();
      },
      overlayVisibility: () => ({
        tracks: mapTools.tracks,
        coverage: mapTools.coverage,
        grid: mapTools.grid,
        ruler: mapTools.ruler,
      }),
      onViewportChanged: (viewport) => {
        mapViewport = viewport;
        void window.aprsbox.config
          .saveMapViewport(viewport)
          .catch(console.error);
      },
      resetCenter: () => {
        const coordinates = parseCoordinates(stationSettings.location);
        return coordinates
          ? ([coordinates.latitude, coordinates.longitude] as [number, number])
          : ([50.055, 19.97] as [number, number]);
      },
    }),
  stations: () => {
    const station = liveStations.find(
      (item) => item.callsign === detailCallsign,
    );
    if (!station) return renderStationsView(liveStations, parseCoordinates(stationSettings.location), stationsViewState);
    return {
      ...renderStationDetails(station, parseCoordinates(stationSettings.location), trafficFrames, liveStations),
      mount: (element: HTMLElement) => {
        const mapElement = element.querySelector<HTMLElement>('.station-detail-map');
        if (!mapElement) return () => undefined;
        const map = mountStationDetailMap(mapElement, station, activeMapSource(mapSettings));
        updateDetailMap = map.update;
        return () => { updateDetailMap = undefined; map.dispose(); };
      },
    };
  },
  traffic: () => renderTrafficMonitorView(trafficFrames, trafficLegendOpen, trafficFilter),
  messages: () =>
    renderMessagesView(
      messages,
      messageRecipient,
      interfaces,
      interfaceStatuses,
    ),
  settings: () =>
    renderSettingsView(
      activeSettingsSection,
      interfaces,
      interfaceDraft,
      selectedInterfaceId,
      interfaceStatuses,
      stationSettings,
      locationAccuracy,
      phgCalculatorOpen,
      phgValues,
      mapSettings,
      mapSourceDraft,
    ),
};

function renderMapDrawer(): string {
  return activeView === 'map' && (mapTools.scroller || mapTools.packet)
    ? createRightPanel({
        station: liveStations.find(
          (station) => station.callsign === selectedCallsign,
        ),
        latestPacket: trafficFrames.find((frame) => frame.direction === 'rx'),
        stations: liveStations,
        showLatestPacket: mapTools.packet,
        showStations: mapTools.scroller,
        frames: trafficFrames,
        ownCallsign: `${stationSettings.callsign}${stationSettings.ssid}`,
        ownPosition: parseCoordinates(stationSettings.location),
      })
    : '';
}

function refreshPacketScroller(): void {
  const scroller = appRoot.querySelector<HTMLElement>('.packet-scroller');
  const scroll = appRoot.querySelector<HTMLElement>('.station-scroll');
  if (!scroller || !scroll) return;
  const scrollTop = scroll.scrollTop;
  const oldHeight = scroll.scrollHeight;
  scroller.innerHTML = renderPacketRows(
    trafficFrames,
    liveStations,
    `${stationSettings.callsign}${stationSettings.ssid}`,
  );
  if (scrollTop > 0)
    scroll.scrollTop = scrollTop + scroll.scrollHeight - oldHeight;
}

function refreshMapDrawer(): void {
  const drawer = appRoot.querySelector<HTMLElement>('.right-panel');
  if (!drawer) return;
  const latest = drawer.querySelector<HTMLElement>('.last-heard-packet');
  if (latest) latest.outerHTML = renderLastPacket(
    trafficFrames.find((frame) => frame.direction === 'rx'),
    liveStations,
    parseCoordinates(stationSettings.location),
  );
  const scroll = drawer.querySelector<HTMLElement>('.station-scroll');
  if (scroll) {
    const top = scroll.scrollTop;
    const previous = scroll.querySelector<HTMLElement>('.station-card');
    const details = renderScrollerStation(liveStations.find((station) => station.callsign === selectedCallsign));
    if (previous && details) {
      if (previous.outerHTML !== details) previous.outerHTML = details;
    } else if (previous) previous.remove();
    else if (details) scroll.insertAdjacentHTML('afterbegin', details);
    scroll.scrollTop = top;
    refreshPacketScroller();
  }
}

function restoreScrollerAfterResume(): void {
  if (scrollerBeforeSleep !== undefined) {
    if (scrollerBeforeSleep.revision === scrollerChangeRevision)
      mapTools.scroller = scrollerBeforeSleep.visible;
    scrollerBeforeSleep = undefined;
  }
  if (activeView !== 'map' || !mapTools.scroller) return;
  const content = appRoot.querySelector<HTMLElement>('.content-area');
  if (!content) return;
  const drawer = content.querySelector<HTMLElement>('.right-panel');
  if (!drawer) content.insertAdjacentHTML('beforeend', renderMapDrawer());
  else if (!drawer.querySelector('.station-panel')) drawer.outerHTML = renderMapDrawer();
  refreshMapDrawer();
}

window.aprsbox.system.onSuspend(() => {
  scrollerBeforeSleep = { visible: mapTools.scroller, revision: scrollerChangeRevision };
});
window.aprsbox.system.onResume(restoreScrollerAfterResume);

setInterval(() => {
  if (activeView === 'map' && mapTools.scroller) refreshPacketScroller();
}, 60_000);

function receiveStations(stations: Station[]): void {
  liveStations = stations;
  if (!stations.some((station) => station.callsign === selectedCallsign)) {
    selectedCallsign = undefined;
  }
  updateStationMarkers?.(stations);
  refreshMapDrawer();
  if (activeView === 'stations') {
    const view = appRoot.querySelector('.view-region');
    const station = stations.find((item) => item.callsign === detailCallsign);
    if (!station) detailCallsign = undefined;
    const toolbar = appRoot.querySelector<HTMLElement>('.topbar .stations-filters');
    if (toolbar) toolbar.innerHTML = station ? '' : renderStationFilters(stations, stationsViewState.filter);
    const searchContainer = appRoot.querySelector<HTMLElement>('.stations-search-container');
    if (searchContainer) {
      const input = searchContainer.querySelector<HTMLInputElement>('[data-stations-search]');
      if (station) searchContainer.innerHTML = '';
      else if (!input) searchContainer.innerHTML = renderStationSearch(stations, stationsViewState);
      else {
        const count = searchContainer.querySelector<HTMLElement>('[data-stations-count]');
        if (count) count.textContent = `${filterStations(stations, stationsViewState.filter, stationsViewState.search).length} entries`;
      }
    }
    if (view) {
      const scroll = view.querySelector<HTMLElement>('.stations-table-wrap');
      const scrollTop = scroll?.scrollTop ?? 0;
      const scrollLeft = scroll?.scrollLeft ?? 0;
      const detailScroll = view.querySelector<HTMLElement>('.station-detail-view')?.scrollTop ?? 0;
      const detailMap = view.querySelector<HTMLElement>('.station-detail-map');
      if (station && detailMap) detailMap.remove();
      else if (!station && detailMap) {
        disposeCurrentView?.();
        disposeCurrentView = undefined;
      }
      view.innerHTML = (
        station
          ? renderStationDetails(
              station,
              parseCoordinates(stationSettings.location),
              trafficFrames,
              stations,
            )
          : renderStationsView(stations, parseCoordinates(stationSettings.location), stationsViewState)
      ).html;
      if (station && detailMap) {
        view.querySelector('.station-detail-map')?.replaceWith(detailMap);
        updateDetailMap?.(station);
        const detail = view.querySelector<HTMLElement>('.station-detail-view');
        if (detail) detail.scrollTop = detailScroll;
      }
      const updatedScroll = view.querySelector<HTMLElement>('.stations-table-wrap');
      if (updatedScroll) {
        updatedScroll.scrollTop = scrollTop;
        updatedScroll.scrollLeft = scrollLeft;
      }
    }
  }
}

appRoot.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const saveLog = event.target.closest<HTMLButtonElement>('[data-action="save-traffic-log"]');
  if (saveLog) {
    if (savingTrafficLog) return;
    savingTrafficLog = true;
    saveLog.disabled = true;
    void window.aprsbox.traffic.saveLog(trafficFilter).catch((error) => {
      alertMessage = { title: 'Traffic log not saved', message: error instanceof Error ? error.message : String(error), tone: 'error' };
      renderApp();
    }).finally(() => { savingTrafficLog = false; saveLog.disabled = false; });
    return;
  }
  const clearMapCache = event.target.closest<HTMLButtonElement>('[data-map-clear-cache]');
  if (clearMapCache?.dataset.mapClearCache) {
    const id = clearMapCache.dataset.mapClearCache;
    clearMapCache.disabled = true;
    void window.aprsbox.config.clearMapCache(id).then(() => updateMapCacheStats(id)).catch((error) => {
      alertMessage = { title: 'Cache not cleared', message: error instanceof Error ? error.message : String(error), tone: 'error' };
      renderApp();
    }).finally(() => { clearMapCache.disabled = false; });
    return;
  }
  if (event.target.closest('[data-action="clear-stations-search"]')) {
    stationsViewState.search = '';
    const input = appRoot.querySelector<HTMLInputElement>('[data-stations-search]');
    if (input) { input.value = ''; input.focus(); }
    const clear = appRoot.querySelector<HTMLButtonElement>('[data-action="clear-stations-search"]');
    if (clear) clear.disabled = true;
    receiveStations(liveStations);
    return;
  }
  if (event.target.closest('[data-action="clear-traffic-filter"]')) {
    trafficFilter = '';
    const input = appRoot.querySelector<HTMLInputElement>('[data-traffic-filter]');
    if (input) { input.value = ''; input.focus(); }
    refreshTrafficMonitor();
    return;
  }
  const editMap = event.target.closest<HTMLButtonElement>('[data-map-edit]');
  if (editMap) {
    mapSourceDraft = mapSettings.sources.find((item) => item.id === editMap.dataset.mapEdit);
    if (mapSourceDraft) mapSourceDraft = { ...mapSourceDraft };
    renderApp();
    return;
  }
  if (event.target.closest('[data-action="cancel-map-edit"]')) {
    mapSourceDraft = undefined;
    renderApp();
    return;
  }
  const defaultMap = event.target.closest<HTMLButtonElement>('[data-map-default]');
  if (defaultMap?.dataset.mapDefault) {
    void saveMapSettings({ ...mapSettings, defaultSourceId: defaultMap.dataset.mapDefault });
    return;
  }
  const deleteMap = event.target.closest<HTMLButtonElement>('[data-map-delete]');
  if (deleteMap?.dataset.mapDelete && deleteMap.dataset.mapDelete !== mapSettings.defaultSourceId) {
    const id = deleteMap.dataset.mapDelete;
    if (mapSourceDraft?.id === id) mapSourceDraft = undefined;
    void saveMapSettings({ ...mapSettings, sources: mapSettings.sources.filter((item) => item.id !== id) });
    return;
  }
  if (event.target.closest('[data-action="save-coverage"]')) {
    const select = appRoot.querySelector<HTMLSelectElement>('[data-coverage-opacity]');
    if (select) void saveMapSettings({ ...mapSettings, coverageFillOpacity: Number(select.value) });
    return;
  }
  const backup = event.target.closest<HTMLButtonElement>('[data-action="export-config"], [data-action="import-config"]');
  if (backup) {
    backup.disabled = true;
    const importing = backup.dataset.action === 'import-config';
    void (importing ? window.aprsbox.config.importBackup() : window.aprsbox.config.exportBackup()).then((done) => {
      if (!done) { backup.disabled = false; return; }
      if (importing) { window.location.reload(); return; }
      alertMessage = { title: 'Backup exported', message: 'Configuration backup saved.', tone: 'success' };
      renderApp();
    }).catch((error) => {
      alertMessage = { title: 'Backup failed', message: error instanceof Error ? error.message : String(error), tone: 'error' };
      renderApp();
    });
    return;
  }
  if (event.target.closest('[data-action="traffic-legend"]')) {
    trafficLegendOpen = true;
    renderApp();
    return;
  }
  if (event.target.matches('.traffic-legend-backdrop') || event.target.closest('button[data-action="close-traffic-legend"]')) {
    trafficLegendOpen = false;
    renderApp();
    return;
  }
  const filter = event.target.closest<HTMLButtonElement>('[data-stations-filter]');
  if (filter?.dataset.stationsFilter) {
    stationsViewState.filter = filter.dataset.stationsFilter as StationFilter;
    renderApp();
    return;
  }
  const sort = event.target.closest<HTMLButtonElement>('[data-stations-sort]');
  if (sort?.dataset.stationsSort) {
    const key = sort.dataset.stationsSort as StationSort;
    if (stationsViewState.sort === key) stationsViewState.direction = stationsViewState.direction === 'asc' ? 'desc' : 'asc';
    else {
      stationsViewState.sort = key;
      stationsViewState.direction = key === 'lastHeard' ? 'desc' : 'asc';
    }
    renderApp();
    return;
  }
  const symbol = event.target.closest<HTMLButtonElement>('[data-symbol-code]');
  if (symbol?.dataset.symbolCode) {
    stationSettings.symbolCode = symbol.dataset.symbolCode;
    renderApp();
    return;
  }
  const conversation = event.target.closest<HTMLButtonElement>(
    '[data-message-conversation]',
  );
  if (conversation?.dataset.messageConversation) {
    messageRecipient = conversation.dataset.messageConversation;
    renderApp();
    return;
  }
  const retry = event.target.closest<HTMLButtonElement>('[data-retry-message]');
  if (retry?.dataset.retryMessage) {
    void window.aprsbox.messages
      .retry(retry.dataset.retryMessage)
      .catch((error) => {
        const output = appRoot.querySelector<HTMLElement>(
          '[data-message-error]',
        );
        if (output) output.textContent = String(error);
      });
    return;
  }
  if (event.target.closest('[data-action="stations-back"]')) {
    detailCallsign = undefined;
    renderApp();
    return;
  }
  if (event.target.closest('[data-action="station-message"]') && detailCallsign) {
    messageRecipient = detailCallsign;
    activeView = 'messages';
    renderApp();
    return;
  }
  const stationButton =
    event.target.closest<HTMLElement>('[data-station]');
  if (stationButton) {
    if (activeView === 'stations') {
      detailCallsign = stationButton.dataset.station;
      renderApp();
      return;
    }
    selectedCallsign = stationButton.dataset.station;
    refreshMapDrawer();
  }
  if (event.target.closest('.right-panel [data-action="close-scroller"]')) {
    mapTools.scroller = false;
    scrollerVisibilityChanged = true;
    scrollerChangeRevision++;
    void window.aprsbox.config.saveScrollerVisibility(false).catch(console.error);
    renderApp();
  }
});

appRoot.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.matches('[data-stations-search]')) {
    stationsViewState.search = event.target.value;
    const clear = appRoot.querySelector<HTMLButtonElement>('[data-action="clear-stations-search"]');
    if (clear) clear.disabled = !stationsViewState.search.trim();
    receiveStations(liveStations);
    return;
  }
  if (event.target instanceof HTMLInputElement && event.target.matches('[data-traffic-filter]')) {
    trafficFilter = event.target.value;
    refreshTrafficMonitor();
  }
});

appRoot.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && trafficLegendOpen) {
    trafficLegendOpen = false;
    renderApp();
    return;
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLElement && event.target.matches('.stations-table tr[data-station]')) {
    event.preventDefault();
    event.target.click();
  }
});

appRoot.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.matches('[data-map-source-form]')) {
    event.preventDefault();
    const values = new FormData(form);
    const id = String(values.get('id') || crypto.randomUUID());
    const source: MapSource = { id, name: String(values.get('name') ?? ''), url: String(values.get('url') ?? ''), attribution: String(values.get('attribution') ?? ''), minZoom: Number(values.get('minZoom')), maxZoom: Number(values.get('maxZoom')), enabled: values.has('enabled'), cacheEnabled: values.has('cacheEnabled') };
    mapSourceDraft = source;
    const found = mapSettings.sources.some((item) => item.id === id);
    const sources = found ? mapSettings.sources.map((item) => item.id === id ? source : item) : [...mapSettings.sources, source];
    void saveMapSettings({ ...mapSettings, sources }, true);
    return;
  }
  if (form.matches('[data-message-new]')) {
    event.preventDefault();
    const value = String(new FormData(form).get('recipient') ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{1,6}(?:-(?:[0-9]|1[0-5]))?$/.test(value)) {
      const input = form.querySelector<HTMLInputElement>(
        'input[name="recipient"]',
      );
      input?.setCustomValidity('Enter a valid callsign and SSID.');
      input?.reportValidity();
      input?.addEventListener('input', () => input.setCustomValidity(''), {
        once: true,
      });
      return;
    }
    messageRecipient = value.replace(/-0$/, '');
    renderApp();
    return;
  }
  if (!form.matches('[data-message-send]') || !messageRecipient) return;
  event.preventDefault();
  const values = new FormData(form);
  const request = {
    recipient: messageRecipient,
    text: String(values.get('text') ?? ''),
    interfaceId: String(values.get('interfaceId') ?? ''),
    path: String(values.get('path') ?? ''),
  };
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const output = form.querySelector<HTMLElement>('[data-message-error]');
  if (submit) submit.disabled = true;
  if (output) output.textContent = '';
  void window.aprsbox.messages
    .send(request)
    .then(() => {
      const input = form.querySelector<HTMLTextAreaElement>(
        'textarea[name="text"]',
      );
      if (input && input.value === request.text) input.value = '';
    })
    .catch((error) => {
      if (output) output.textContent = String(error);
    })
    .finally(() => {
      if (submit) submit.disabled = false;
    });
});

function updateMessages(next: AprsMessage[]): void {
  messages = next;
  if (activeView !== 'messages') return;
  const history = appRoot.querySelector<HTMLElement>('[data-message-history]');
  if (history && messageRecipient) {
    const atBottom =
      history.scrollHeight - history.scrollTop - history.clientHeight < 32;
    history.innerHTML = renderMessageHistory(messages, messageRecipient);
    if (atBottom) history.scrollTop = history.scrollHeight;
  }
  const list = appRoot.querySelector<HTMLElement>('.messages-conversations');
  if (list) {
    const template = document.createElement('template');
    template.innerHTML = renderMessagesView(
      messages,
      messageRecipient,
      interfaces,
      interfaceStatuses,
    ).html;
    list.innerHTML =
      template.content.querySelector('.messages-conversations')?.innerHTML ??
      '';
  }
}

function renderApp(): void {
  const page = pageRenderers[activeView]();
  const mapDrawer = renderMapDrawer();
  const existingMap =
    mountedView === 'map' && activeView === 'map'
      ? appRoot.querySelector<HTMLElement>('.view-region')
      : null;
  if (existingMap) existingMap.remove();
  else {
    disposeCurrentView?.();
    disposeCurrentView = undefined;
  }
  mountedLocationPicker?.dispose();
  mountedLocationPicker = undefined;
  const resolvedTheme =
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  appRoot.innerHTML = `<div class="app-shell">${createSidebar(activeView)}<div class="workspace">${createTopbar(activeView, mapTools, themeMode, activeSettingsSection, `${stationSettings.callsign}${stationSettings.ssid}`, mapMaskOpacity[resolvedTheme], detailCallsign ? '' : renderStationFilters(liveStations, stationsViewState.filter), interfaces, interfaceStatuses, activeView === 'traffic' ? renderTrafficFilter(trafficFrames, trafficFilter) : '', activeView === 'stations' && !detailCallsign ? renderStationSearch(liveStations, stationsViewState) : '')}<main class="content-area"><section class="view-region" aria-live="polite">${page.html}</section>${mapDrawer}</main></div></div>${locationPickerOpen && locationPickerCenter ? createLocationPicker(locationPickerCenter) : ''}${createAlertDialog(alertMessage)}${createConfirmDialog(confirmation)}`;
  if (existingMap) {
    appRoot.querySelector('.view-region')?.replaceWith(existingMap);
    window.dispatchEvent(new Event('aprs-map:visible'));
  }
  if (locationPickerOpen && locationPickerCenter) {
    mountedLocationPicker = mountLocationPicker(appRoot, locationPickerCenter, activeMapSource(mapSettings));
  }
  const configPath = appRoot.querySelector<HTMLElement>('[data-config-path]');
  if (configPath) {
    void window.aprsbox.config
      .getActivePath()
      .then(({ path: activePath }) => {
        configPath.textContent = activePath;
      })
      .catch(() => {
        configPath.textContent = 'Configuration path unavailable.';
      });
  }
  if (activeView === 'settings' && activeSettingsSection === 'general') {
    for (const source of mapSettings.sources) void updateMapCacheStats(source.id);
  }
  appRoot.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) =>
    button.addEventListener('click', () => {
      if (button.dataset.view === 'stations') detailCallsign = undefined;
      if (button.dataset.view === 'messages') messageRecipient = undefined;
      activeView = button.dataset.view as AppView;
      renderApp();
    }),
  );
  appRoot
    .querySelector<HTMLSelectElement>('[data-map-mask]')
    ?.addEventListener('change', (event) => {
      const value = Number((event.currentTarget as HTMLSelectElement).value);
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value > 100 ||
        value % 10 !== 0
      )
        return;
      const theme =
        document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      mapMaskOpacity[theme] = value;
      applyTheme();
      void window.aprsbox.config
        .saveMapMask({ ...mapMaskOpacity })
        .catch(console.error);
    });
  appRoot
    .querySelectorAll<HTMLButtonElement>(
      '.topbar [data-tool]',
    )
    .forEach((button) =>
      button.addEventListener('click', () => {
        const tool = button.dataset.tool as MapToolId;
        mapTools[tool] = !mapTools[tool];
        if (tool === 'scroller') {
          scrollerVisibilityChanged = true;
          scrollerChangeRevision++;
          void window.aprsbox.config.saveScrollerVisibility(mapTools.scroller).catch(console.error);
        }
        window.dispatchEvent(new Event('aprs-map:overlays'));
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="cycle-theme"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        themeMode =
          themeMode === 'light'
            ? 'dark'
            : themeMode === 'dark'
              ? 'system'
              : 'light';
        applyTheme();
        renderApp();
        appRoot
          .querySelector<HTMLButtonElement>('[data-action="cycle-theme"]')
          ?.focus();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-settings-section]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        activeSettingsSection = button.dataset
          .settingsSection as SettingsSection;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-interface]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        const selected = interfaces.find(
          (item) => item.id === button.dataset.interface,
        );
        if (!selected) return;
        selectedInterfaceId = selected.id;
        interfaceDraft = { ...selected };
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-interface-field]',
    )
    .forEach((field) => {
      const update = () => {
        const key = field.dataset.interfaceField as keyof InterfaceSettings;
        const value =
          field instanceof HTMLInputElement && field.type === 'checkbox'
            ? field.checked
            : field.value;
        interfaceDraft = {
          ...interfaceDraft,
          [key]: value,
        } as InterfaceSettings;
        if (key === 'type') renderApp();
      };
      field.addEventListener('input', update);
      field.addEventListener('change', update);
    });
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="send-beacon"]')
    .forEach((button) => button.addEventListener('click', async () => {
      if (beaconSending) return;
      beaconSending = true;
      appRoot.querySelectorAll<HTMLButtonElement>('[data-action="send-beacon"]')
        .forEach((control) => { control.disabled = true; });
      try {
        await window.aprsbox.config.sendBeacon({ ...stationSettings });
        alertMessage = {
          title: 'Beacon sent',
          message: 'Position frame sent to the selected KISS interface.',
          tone: 'success',
        };
      } catch (error) {
        alertMessage = {
          title: 'Beacon not sent',
          message: error instanceof Error ? error.message : String(error),
          tone: 'error',
        };
      }
      beaconSending = false;
      renderApp();
    }));
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="new-interface"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        selectedInterfaceId = undefined;
        interfaceDraft = createInterfaceDraft();
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="save-interface"]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const savedInterface: InterfaceSettings = {
          ...interfaceDraft,
          id: interfaceDraft.id || crypto.randomUUID(),
          name: interfaceDraft.name.trim() || 'KISS interface',
        };
        const nextInterfaces = selectedInterfaceId
          ? interfaces.map((item) =>
              item.id === selectedInterfaceId ? savedInterface : item,
            )
          : [...interfaces, savedInterface];
        try {
          await window.aprsbox.config.saveInterfaces(nextInterfaces);
          interfaces = nextInterfaces;
          selectedInterfaceId = savedInterface.id;
          interfaceDraft = { ...savedInterface };
          alertMessage = {
            title: 'Interface saved',
            message:
              'Interface configuration was saved to the active configuration file.',
            tone: 'success',
          };
        } catch {
          alertMessage = {
            title: 'Save failed',
            message:
              'Interface configuration could not be written to the configuration file.',
            tone: 'error',
          };
        }
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="toggle-interface"]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const id = button.dataset.interfaceId;
        const nextInterfaces = interfaces.map((item) =>
          item.id === id ? { ...item, enabled: !item.enabled } : item,
        );
        try {
          await window.aprsbox.config.saveInterfaces(nextInterfaces);
          interfaces = nextInterfaces;
          const selected = interfaces.find(
            (item) => item.id === selectedInterfaceId,
          );
          if (selected) interfaceDraft = { ...selected };
        } catch {
          alertMessage = {
            title: 'Update failed',
            message: 'The interface state could not be saved.',
            tone: 'error',
          };
        }
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>(
      '[data-action="request-delete-interface"]',
    )
    .forEach((button) =>
      button.addEventListener('click', () => {
        const target = interfaces.find(
          (item) => item.id === button.dataset.interfaceId,
        );
        if (!target) return;
        pendingInterfaceDeletion = target;
        confirmation = {
          title: 'Delete interface?',
          message: `Do you want to delete “${target.name || 'this interface'}”?`,
        };
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>(
      '[data-action="cancel-delete-interface"]',
    )
    .forEach((button) =>
      button.addEventListener('click', () => {
        confirmation = undefined;
        pendingInterfaceDeletion = undefined;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>(
      '[data-action="confirm-delete-interface"]',
    )
    .forEach((button) =>
      button.addEventListener('click', async () => {
        if (!pendingInterfaceDeletion) return;
        const deletedId = pendingInterfaceDeletion.id;
        const nextInterfaces = interfaces.filter(
          (item) => item.id !== deletedId,
        );
        try {
          await window.aprsbox.config.saveInterfaces(nextInterfaces);
          interfaces = nextInterfaces;
          if (selectedInterfaceId === deletedId) {
            selectedInterfaceId = undefined;
            interfaceDraft = createInterfaceDraft();
          }
        } catch {
          alertMessage = {
            title: 'Delete failed',
            message:
              'The interface could not be removed from the configuration file.',
            tone: 'error',
          };
        }
        confirmation = undefined;
        pendingInterfaceDeletion = undefined;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-station-field]',
    )
    .forEach((field) => {
      const update = () => {
        const key = field.dataset.stationField as keyof StationSettings;
        stationSettings[key] = field.value;
      };
      field.addEventListener('input', update);
      field.addEventListener('change', update);
      if (field.dataset.stationField === 'symbolTable') {
        field.addEventListener('change', () => {
          if (stationSettings.symbolTable === '/')
            stationSettings.symbolOverlay = '';
          renderApp();
        });
      }
    });
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="save-station"]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        try {
          await window.aprsbox.config.saveStation(stationSettings);
          alertMessage = {
            title: 'Station saved',
            message:
              'Station settings were saved to the active configuration file.',
            tone: 'success',
          };
        } catch {
          alertMessage = {
            title: 'Save failed',
            message:
              'Station settings could not be written to the configuration file.',
            tone: 'error',
          };
        }
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="get-location"]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        try {
          applySystemLocation(await requestFreshSystemLocation());
        } catch {
          alertMessage = {
            title: 'Location unavailable',
            message:
              'System location could not be obtained. Check the operating system location permission.',
            tone: 'error',
          };
        }
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="open-location-picker"]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        try {
          const coords = await requestFreshSystemLocation();
          const freshCenter = {
            latitude: coords.latitude,
            longitude: coords.longitude,
          };
          locationAccuracy = `System location accuracy: ±${Math.round(coords.accuracy)} m`;
          locationPickerCenter = freshCenter;
        } catch {
          const stationCoordinates = parseCoordinates(stationSettings.location);
          if (!stationCoordinates) {
            alertMessage = {
              title: 'Location unavailable',
              message:
                'System location is unavailable and the station location is not valid.',
              tone: 'error',
            };
            renderApp();
            return;
          }
          locationPickerCenter = stationCoordinates;
          locationAccuracy =
            'System location unavailable; centered on station location.';
        }
        locationPickerOpen = true;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>(
      '[data-action="close-location-picker"]',
    )
    .forEach((button) =>
      button.addEventListener('click', () => {
        locationPickerOpen = false;
        locationPickerCenter = undefined;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="use-picker-location"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        const coordinates = mountedLocationPicker?.getCenter();
        if (!coordinates) return;
        stationSettings.location = formatCoordinates(coordinates);
        locationAccuracy = 'Selected on map.';
        locationPickerOpen = false;
        locationPickerCenter = undefined;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="open-phg"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        stationSettings.comment =
          appRoot.querySelector<HTMLInputElement>('[data-comment-input]')
            ?.value ?? stationSettings.comment;
        phgCalculatorOpen = true;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="close-phg"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        phgCalculatorOpen = false;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLSelectElement>('[data-phg-field]')
    .forEach((select) =>
      select.addEventListener('change', () => {
        const field = select.dataset.phgField as keyof PhgValues;
        phgValues = { ...phgValues, [field]: select.value };
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="apply-phg"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        const code = button.dataset.phgCode ?? '';
        const comment = stationSettings.comment.replace(/^PHG\d{4}\s*/, '');
        stationSettings.comment =
          `${code}${comment ? ` ${comment}` : ''}`.slice(0, 36);
        phgCalculatorOpen = false;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLInputElement>('[data-comment-input]')
    .forEach((input) =>
      input.addEventListener('input', () => {
        stationSettings.comment = input.value;
        const counter = appRoot.querySelector<HTMLElement>(
          '[data-comment-count]',
        );
        if (counter) counter.textContent = String(input.value.length);
      }),
    );
  appRoot
    .querySelectorAll<HTMLInputElement>('[data-location-input]')
    .forEach((input) =>
      input.addEventListener('input', () => {
        stationSettings.location = input.value;
      }),
    );
  appRoot
    .querySelectorAll<HTMLInputElement>('[data-status-input]')
    .forEach((input) =>
      input.addEventListener('input', () => {
        stationSettings.status = input.value;
        const counter = appRoot.querySelector<HTMLElement>(
          '[data-status-count]',
        );
        if (counter) counter.textContent = String(input.value.length);
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="reset-map"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        window.dispatchEvent(new Event('aprs-map:reset'));
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="close-alert"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        alertMessage = undefined;
        renderApp();
      }),
    );
  const viewRoot = appRoot.querySelector<HTMLElement>('.view-region');
  if (!existingMap) {
    disposeCurrentView =
      viewRoot && page.mount ? page.mount(viewRoot) : undefined;
  }
  mountedView = activeView;
}

applyTheme();
let receivedLiveMessages = false;
window.aprsbox.messages.onChanged((next) => {
  receivedLiveMessages = true;
  updateMessages(next);
});
void window.aprsbox.messages
  .get()
  .then((next) => {
    if (!receivedLiveMessages) updateMessages(next);
  })
  .catch(console.error);
let receivedLiveStations = false;
window.aprsbox.stations.onChanged((stations) => {
  receivedLiveStations = true;
  receiveStations(stations);
});
void window.aprsbox.stations
  .get()
  .then((stations) => {
    if (!receivedLiveStations) receiveStations(stations);
  })
  .catch(console.error);
void loadConfiguration();
void loadTraffic();

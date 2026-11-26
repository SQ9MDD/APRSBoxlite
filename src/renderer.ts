import { DEFAULT_STATION, profileLabel, type StationProfile, type ProfileAction } from './stationProfiles';
import { renderProfileDialog, type ProfileDialog } from './views/StationProfilesView';
import { playMessageSound } from './messageSound';
import { normalizeMessageGroups, readMessageGroups } from './messageGroups';
import { defaultAprsIsFilter } from './aprsIsFilter';
import './index.css';
import { installTooltips } from './components/Tooltips';

installTooltips();
import { scanBle, cancelBleScan, cancelPendingBleTransmissions, disconnectBle, reconcileBle, noteBleDevices, isBleScanning, isAnyBleScanning, hasBleLink, transmitBle } from './bleTransport';
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
import { createTopbar, renderInterfaceStatusIcons } from './components/Topbar';
import type { MapToolId, MapToolState, ThemeMode } from './components/Topbar';
import { createRightPanel, renderLastPacket, renderScrollerStation } from './components/RightPanel';
import { renderPacketRows } from './components/PacketScroller';
import { renderMapView } from './views/MapView';
import type { MapViewport } from './views/MapView';
import type { RulerState } from './views/MapRuler';
import { isVisibleInConversation, renderMessageHistory, renderMessagesView } from './views/MessagesView';
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
let clockMode: 'utc' | 'local' = 'utc';
let clockModeChanged = false;
function updateSidebarClock(): void {
  const clock = appRoot.querySelector<HTMLElement>('[data-action="toggle-clock"]');
  if (!clock) return;
  const now = new Date();
  const utc = clockMode === 'utc';
  const pad = (value: number) => String(value).padStart(2, '0');
  const time = clock.querySelector<HTMLElement>('[data-clock-time]');
  const date = clock.querySelector<HTMLElement>('[data-clock-date]');
  const zone = clock.querySelector<HTMLElement>('[data-clock-zone]');
  if (time) time.textContent = [utc ? now.getUTCHours() : now.getHours(), utc ? now.getUTCMinutes() : now.getMinutes(), utc ? now.getUTCSeconds() : now.getSeconds()].map(pad).join(':');
  if (date) date.textContent = [utc ? now.getUTCFullYear() : now.getFullYear(), pad((utc ? now.getUTCMonth() : now.getMonth()) + 1), pad(utc ? now.getUTCDate() : now.getDate())].join('.');
  if (zone) zone.textContent = utc ? 'UTC' : 'LOC';
  clock.title = utc ? 'UTC (click for LOC)' : 'LOC (click for UTC)';
  clock.setAttribute('aria-label', utc ? 'UTC clock; switch to local time' : 'Local clock; switch to UTC');
}
setInterval(updateSidebarClock, 1000);
let selectedCallsign: string | undefined;
let detailCallsign: string | undefined;
const stationsViewState: StationsViewState = { filter: 'all', sort: 'lastHeard', direction: 'desc', search: '' };
let messageRecipient: string | undefined;
let messageInterfaceId = '';
let messageInterfaceChanged = false;
let messagePaths: Record<string, string> = {};
let messageGroups = readMessageGroups(undefined);
const messagePathTimers = new Map<string, ReturnType<typeof setTimeout>>();
const modifiedMessagePaths = new Set<string>();
let messages: AprsMessage[] = [];
let liveStations: Station[] = [];
let updateStationMarkers: ((stations: Station[]) => void) | undefined;
let updateDetailMap: ((station: Station) => void) | undefined;
let mapViewport: MapViewport | undefined;
let mapSettings: MapSettings = structuredClone(DEFAULT_MAP_SETTINGS);
let mapSourceDraft: MapSource | undefined;
const rulerState: RulerState = { measurementActive: false };
let mountedView: AppView | undefined;
let mountedMessageRecipient: string | undefined;
let activeSettingsSection: SettingsSection = 'general';
let selectedInterfaceId: string | undefined;
let interfaces: InterfaceSettings[] = [];
let interfaceDraft: InterfaceSettings = createInterfaceDraft();
let bleDevices: Array<{ id: string; name: string }> = [];
let bleScanInterfaceId: string | undefined;
let bleSelectedDeviceId = '';
let bleScanMessage = 'Start scanning to find devices.';
let bleAutoTarget: string | undefined;
let bleAutoRequest = false;
const bleLastAttempt = new Map<string, number>();
const blePendingSelection = new Map<string, { id: string; name: string }>();
function chooseBleDevice(interfaceId: string, deviceId: string): void {
  const device = bleDevices.find((entry) => entry.id === deviceId);
  if (!device) return;
  blePendingSelection.set(interfaceId, { id: device.id, name: device.name || '' });
  window.aprsbox.ble.choose(deviceId);
}
window.aprsbox.ble.onWrite(({ requestId, interfaceId, bytes }) => {
  void transmitBle(interfaceId, bytes).then(
    () => window.aprsbox.ble.writeResult(requestId, null),
    (error) => window.aprsbox.ble.writeResult(requestId, error instanceof Error ? error.message : String(error)),
  );
});
window.aprsbox.ble.onDevices((devices) => {
  bleDevices = devices; noteBleDevices(devices.length > 0); updateBleDevices();
  const config = interfaces.find((item) => item.id === bleAutoTarget && item.enabled && item.type === 'kiss-ble');
  if (config?.bleDeviceId && devices.some((item) => item.id === config.bleDeviceId)) {
    const id = config.id; bleAutoTarget = undefined; chooseBleDevice(id, config.bleDeviceId);
  }
});
window.addEventListener('aprsbox:ble-auto-scan', () => {
  const config = interfaces.find((item) => item.id === bleAutoTarget && item.enabled && item.type === 'kiss-ble' && item.bleDeviceId);
  if (!config || isAnyBleScanning() || hasBleLink(config.id)) { bleAutoTarget = undefined; return; }
  try {
    bleScanInterfaceId = config.id;
    scanBle(config.id, config.reconnectTimeout, (message) => { bleScanMessage = message; updateBleDevices(); }, true);
  } catch { bleAutoTarget = undefined; }
});
function reconnectRememberedBle(): void {
  if (bleAutoRequest || isAnyBleScanning()) return;
  const now = Date.now();
  const config = interfaces.find((item) => item.type === 'kiss-ble' && item.enabled && item.bleDeviceId && !hasBleLink(item.id) && now - (bleLastAttempt.get(item.id) ?? 0) >= Math.max(5000, (Number(item.reconnectTimeout) || 5) * 1000));
  if (!config) return;
  bleLastAttempt.set(config.id, now);
  bleAutoTarget = config.id; bleAutoRequest = true;
  void window.aprsbox.ble.autoScan().catch(() => { bleAutoTarget = undefined; }).finally(() => { bleAutoRequest = false; });
}
setInterval(reconnectRememberedBle, 5000);
function updateBleDevices(): void {
  const select = appRoot.querySelector<HTMLSelectElement>('[data-ble-devices]');
  if (!select) return;
  if (document.activeElement !== select) {
    const top = select.scrollTop;
    select.replaceChildren(...bleDevices.map((device) => new Option(device.name?.includes(device.id) ? device.name : `${device.name || 'Unnamed Bluetooth device'} · ${device.id}`, device.id)));
    select.value = bleSelectedDeviceId;
    select.scrollTop = top;
  }
  const message = appRoot.querySelector<HTMLElement>('[data-ble-status]');
  if (message) message.textContent = bleScanMessage;
}
let themeMode: ThemeMode = 'system';
let beaconSending = false;
let statusSending = false;
let mapMaskOpacity = { light: 10, dark: 20 };
let stationSettings: StationSettings = { ...DEFAULT_STATION };
let stationProfiles: StationProfile[] = [];
let activeProfileId = '';
let profileBusy = false;
let profileDialog: ProfileDialog | undefined;
const activeProfile = () => stationProfiles.find((profile) => profile.id === activeProfileId);
const activeProfileLabel = () => {
  const index = stationProfiles.findIndex((profile) => profile.id === activeProfileId);
  return stationProfiles.length > 1 && index >= 0 ? profileLabel(stationProfiles[index], index) : '';
};
let alertMessage: AlertMessage | undefined;
let confirmation: Confirmation | undefined;
let pendingProfileSwitch: string | undefined;
let pendingInterfaceDeletion: InterfaceSettings | undefined;
let pendingConversationDeletion: string | undefined;
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
  packetRoutes: true,
};
const changedMapTools = new Set<MapToolId>();
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
    aprsIsServer: 'rotate.aprs2.net:14580',
    aprsIsRadius: '25',
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
  stationSettings = { ...DEFAULT_STATION };
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
  reconcileBle(interfaces);
}

function applyProfileConfiguration(configuration: Record<string, unknown>, force = false): void {
  const changed = activeProfileId !== configuration.activeProfileId;
  if (changed) cancelPendingBleTransmissions();
  stationProfiles = configuration.profiles as StationProfile[];
  activeProfileId = configuration.activeProfileId as string;
  applyStoredInterfaces(configuration);
  if (changed || force) {
    for (const timer of messagePathTimers.values()) clearTimeout(timer);
    messagePathTimers.clear();
    modifiedMessagePaths.clear();
    messagePaths = {};
    messageInterfaceChanged = false;
    messageInterfaceId = typeof configuration.messageInterfaceId === 'string' ? configuration.messageInterfaceId : '';
    try { messageGroups = readMessageGroups(configuration.messageGroups); } catch { messageGroups = readMessageGroups(undefined); }
    if (configuration.messagePaths && typeof configuration.messagePaths === 'object') {
      for (const [recipient, path] of Object.entries(configuration.messagePaths)) {
        if (typeof path === 'string') messagePaths[recipient] = path;
      }
    }
    applyStoredStationConfiguration(configuration);
    const phg = stationSettings.comment.match(/^PHG(\d)(\d)(\d)(\d)/);
    phgValues = phg ? { power: phg[1], height: phg[2], gain: phg[3], direction: phg[4] } : { power: '5', height: '3', gain: '2', direction: '0' };
    phgCalculatorOpen = false;
    locationPickerOpen = false;
    locationAccuracy = undefined;
    selectedInterfaceId = undefined;
    interfaceDraft = createInterfaceDraft();
    bleAutoTarget = undefined;
    blePendingSelection.clear();
  }
}

window.aprsbox.config.onRuntimeChanged((configuration) => {
  const changed = activeProfileId !== configuration.activeProfileId;
  if (changed) applyProfileConfiguration(configuration);
  else {
    const previous = activeProfile();
    stationProfiles = configuration.profiles as StationProfile[];
    if (previous?.station.callsign !== activeProfile()?.station.callsign || previous?.station.ssid !== activeProfile()?.station.ssid)
      cancelPendingBleTransmissions();
    applyStoredInterfaces(configuration);
  }
  if (changed) renderApp();
  else {
    updateTopbarInterfaceStatuses();
    const name = appRoot.querySelector<HTMLElement>('.topbar-profile');
    if (name) { name.textContent = activeProfileLabel(); name.title = `Active profile: ${name.textContent}`; name.hidden = !name.textContent; }
    const callsign = appRoot.querySelector<HTMLElement>('.topbar-callsign');
    const station = activeProfile()?.station;
    if (callsign && station) callsign.textContent = station.callsign ? (station.callsign + station.ssid).replace(/-0$/, '') : 'No callsign';
  }
});

async function changeProfile(action: ProfileAction): Promise<void> {
  if (profileBusy) return;
  profileBusy = true;
  profileDialog = undefined;
  confirmation = undefined;
  renderApp();
  try {
    // Flush debounced conversation paths to the outgoing profile before switching.
    for (const [recipient, timer] of messagePathTimers) {
      clearTimeout(timer);
      await window.aprsbox.config.saveMessagePath(recipient, messagePaths[recipient] ?? '', activeProfileId);
    }
    messagePathTimers.clear();
    const configuration = await window.aprsbox.config.profileAction(action, activeProfileId, stationSettings);
    if (action.action === 'rename') stationProfiles = configuration.profiles as StationProfile[];
    else applyProfileConfiguration(configuration, true);
  } catch (error) {
    alertMessage = { title: 'Profile not changed', message: error instanceof Error ? error.message : String(error), tone: 'error' };
  } finally {
    profileBusy = false;
    renderApp();
  }
}

function isInterfaceSettings(value: unknown): value is InterfaceSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    (item.type === 'kiss-tcp' || item.type === 'kiss-serial' || item.type === 'kiss-ble' || item.type === 'aprs-is') &&
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
    if (!clockModeChanged && (configuration.clockMode === 'utc' || configuration.clockMode === 'local')) clockMode = configuration.clockMode;
    if (configuration.mapSettings !== undefined) {
      try { mapSettings = validateMapSettings(configuration.mapSettings); } catch { /* Keep the default source if saved settings are invalid. */ }
    }
    const savedMapTools = configuration.mapTools && typeof configuration.mapTools === 'object' && !Array.isArray(configuration.mapTools)
      ? configuration.mapTools as Record<string, unknown> : {};
    for (const tool of Object.keys(mapTools) as MapToolId[]) {
      if (!changedMapTools.has(tool) && typeof savedMapTools[tool] === 'boolean') mapTools[tool] = savedMapTools[tool];
    }
    if (!changedMapTools.has('scroller') && typeof savedMapTools.scroller !== 'boolean' && typeof configuration.scrollerVisible === 'boolean')
      mapTools.scroller = configuration.scrollerVisible;
    window.dispatchEvent(new Event('aprs-map:overlays'));
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
    applyProfileConfiguration(configuration);
    try { messageGroups = readMessageGroups(configuration.messageGroups); } catch { messageGroups = readMessageGroups(undefined); }
    if (!messageInterfaceChanged && typeof configuration.messageInterfaceId === 'string') messageInterfaceId = configuration.messageInterfaceId;
    if (configuration.messagePaths && typeof configuration.messagePaths === 'object' && !Array.isArray(configuration.messagePaths)) {
      for (const [recipient, path] of Object.entries(configuration.messagePaths)) {
        if (!modifiedMessagePaths.has(recipient) && /^(?:[A-Z0-9]{1,9}|[A-Z0-9]{1,6}-(?:[0-9]|1[0-5]))$/.test(recipient) && typeof path === 'string' && path.length <= 71) messagePaths[recipient] = path;
      }
    }
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
  const selected = blePendingSelection.get(interfaceId);
  if (status === 'connected' && selected) {
    blePendingSelection.delete(interfaceId);
    const item = interfaces.find((entry) => entry.id === interfaceId);
    if (item && (item.bleDeviceId !== selected.id || item.bleDeviceName !== selected.name)) {
      void window.aprsbox.ble.remember(interfaceId, selected.id, selected.name).then(() => {
        interfaces = interfaces.map((entry) => entry.id === interfaceId ? { ...entry, bleDeviceId: selected.id, bleDeviceName: selected.name } : entry);
        if (interfaceDraft.id === interfaceId) interfaceDraft = { ...interfaceDraft, bleDeviceId: selected.id, bleDeviceName: selected.name };
        if (activeView === 'settings' && activeSettingsSection === 'interfaces') renderApp();
      }).catch(console.error);
    }
  }
  updateTopbarInterfaceStatuses();
  if (activeView === 'settings' && activeSettingsSection !== 'general' && !(bleScanInterfaceId && isBleScanning(bleScanInterfaceId))) renderApp();
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
  if (container) {
    container.innerHTML = renderInterfaceStatusIcons(interfaces, interfaceStatuses);
    if (profileBusy) container.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  }
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
      ownCallsign: () => `${stationSettings.callsign}${stationSettings.ssid}`,
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
        packetRoutes: mapTools.packetRoutes,
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
      messageInterfaceId,
      messageRecipient ? messagePaths[messageRecipient] ?? '' : '',
      messageGroups,
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
      stationProfiles,
      activeProfileId,
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

let interfaceTogglePending = false;
async function toggleInterface(id: string): Promise<void> {
  if (interfaceTogglePending || !interfaces.some((item) => item.id === id)) return;
  interfaceTogglePending = true;
  const nextInterfaces = interfaces.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item);
  try {
    await window.aprsbox.config.saveInterfaces(nextInterfaces, activeProfileId);
    interfaces = nextInterfaces;
    reconcileBle(interfaces);
    const updated = interfaces.find((item) => item.id === id);
    if (updated && selectedInterfaceId === id && interfaceDraft.id === id) interfaceDraft = { ...interfaceDraft, enabled: updated.enabled };
  } catch (error) {
    alertMessage = { title: 'Update failed', message: error instanceof Error ? error.message : 'The interface state could not be saved.', tone: 'error' };
  } finally {
    interfaceTogglePending = false;
    renderApp();
  }
}

appRoot.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const externalLink = event.target.closest<HTMLAnchorElement>('a[data-external-link]');
  if (externalLink) {
    event.preventDefault();
    event.stopPropagation();
    void window.aprsbox.config.openExternal(externalLink.getAttribute('href') ?? '').catch((error) => {
      alertMessage = { title: 'Link not opened', message: error instanceof Error ? error.message : String(error), tone: 'error' };
      renderApp();
    });
    return;
  }
  if (event.target.closest('[data-action="toggle-clock"]')) {
    clockModeChanged = true;
    clockMode = clockMode === 'utc' ? 'local' : 'utc';
    updateSidebarClock();
    void window.aprsbox.config.saveClockMode(clockMode).catch(console.error);
    return;
  }
  const topbarInterface = event.target.closest<HTMLButtonElement>('[data-topbar-interface]');
  if (topbarInterface?.dataset.topbarInterface) {
    if (!interfaceTogglePending) {
      topbarInterface.disabled = true;
      void toggleInterface(topbarInterface.dataset.topbarInterface);
    }
    return;
  }
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
  if (event.target.closest('[data-action="save-general-map"]')) {
    const coverage = appRoot.querySelector<HTMLSelectElement>('[data-coverage-opacity]');
    const labels = appRoot.querySelector<HTMLSelectElement>('[data-station-label-hide-at-zoom]');
    if (coverage && labels) void saveMapSettings({
      ...mapSettings,
      coverageFillOpacity: Number(coverage.value),
      stationLabelHideAtZoom: Number(labels.value),
    });
    return;
  }
  if (event.target.closest('[data-action="open-map-providers"]')) {
    void window.aprsbox.config.openMapProviders().catch(() => {
      alertMessage = { title: 'Could not open link', message: 'The map provider list could not be opened in your browser.', tone: 'error' };
      renderApp();
    });
    return;
  }
  const updateTocalls = event.target.closest<HTMLButtonElement>('[data-action="update-tocalls"]');
  if (updateTocalls) {
    updateTocalls.disabled = true;
    void window.aprsbox.config.updateTocalls().then((result) => {
      alertMessage = { title: 'TOCALL list updated', message: `${result.count} entries loaded${result.generationTime ? ` · ${result.generationTime}` : ''}. The list is saved for future sessions.`, tone: 'success' };
      renderApp();
    }).catch((error) => {
      alertMessage = { title: 'TOCALL update failed', message: error instanceof Error ? error.message : String(error), tone: 'error' };
      renderApp();
    });
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
  const deleteConversation = event.target.closest<HTMLButtonElement>('[data-delete-conversation]');
  if (deleteConversation?.dataset.deleteConversation) {
    pendingConversationDeletion = deleteConversation.dataset.deleteConversation;
    confirmation = { kind: 'conversation', title: 'Delete conversation?', message: `Delete all messages with “${pendingConversationDeletion}”?` };
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
      .retry(retry.dataset.retryMessage, activeProfileId)
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
    messageRecipient = liveStations.find((station) => station.callsign === detailCallsign)?.owner || detailCallsign;
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
    if (activeView === 'map' && stationButton.matches('.packet-scroller-row')) {
      selectedCallsign = undefined;
      const station = liveStations.find((item) => item.callsign === stationButton.dataset.station);
      if (station && Number.isFinite(station.latitude) && Number.isFinite(station.longitude)) {
        const panelLeft = stationButton.closest<HTMLElement>('.right-panel')?.getBoundingClientRect().left;
        window.dispatchEvent(new CustomEvent('aprs-map:center-station', { detail: { latitude: station.latitude, longitude: station.longitude, panelLeft } }));
      }
    } else {
      selectedCallsign = stationButton.dataset.station;
    }
    refreshMapDrawer();
  }
  if (event.target.closest('.right-panel [data-action="close-scroller"]')) {
    mapTools.scroller = false;
    changedMapTools.add('scroller');
    scrollerChangeRevision++;
    void window.aprsbox.config.saveMapTool('scroller', false).catch(console.error);
    renderApp();
  }
  if (event.target.closest('.right-panel [data-action="close-latest-packet"]')) {
    mapTools.packet = false;
    changedMapTools.add('packet');
    void window.aprsbox.config.saveMapTool('packet', false).catch(console.error);
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
  if (form.matches('[data-profile-dialog]')) {
    event.preventDefault();
    if (profileDialog) void changeProfile({ action: profileDialog.action, id: activeProfileId, name: profileDialog.name });
    return;
  }
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
  if (form.matches('[data-message-groups]')) {
    event.preventDefault();
    const output = form.querySelector<HTMLElement>('[data-message-groups-status]');
    try {
      const values = new FormData(form);
      const next = { rf: normalizeMessageGroups(String(values.get('rf') ?? '')), aprsIs: normalizeMessageGroups(String(values.get('aprsIs') ?? '')) };
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (button) button.disabled = true;
      void window.aprsbox.messages.saveGroups(next, activeProfileId).then(() => {
        messageGroups = next;
        const rf = form.querySelector<HTMLInputElement>('[name="rf"]');
        const aprsIs = form.querySelector<HTMLInputElement>('[name="aprsIs"]');
        if (rf) rf.value = next.rf.join(', ');
        if (aprsIs) aprsIs.value = next.aprsIs.join(', ');
        if (output) output.textContent = 'Settings saved.';
      }).catch((error) => { if (output) output.textContent = String(error); }).finally(() => { if (button) button.disabled = false; });
    } catch (error) { if (output) output.textContent = error instanceof Error ? error.message : String(error); }
    return;
  }
  if (form.matches('[data-message-new]')) {
    event.preventDefault();
    const value = String(new FormData(form).get('recipient') ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{1,6}(?:-(?:[0-9]|1[0-5]))?$/.test(value) && !messageGroups.rf.includes(value) && !messageGroups.aprsIs.includes(value)) {
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
    interfaceId: messageInterfaceId,
    path: String(values.get('path') ?? ''),
  };
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const output = form.querySelector<HTMLElement>('[data-message-error]');
  if (submit) submit.disabled = true;
  if (output) output.textContent = '';
  void window.aprsbox.messages
    .send(request, activeProfileId)
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

const markingRead = new Set<string>();
function syncMessageUnread(): void {
  const unread = messages.some((message) => message.unread);
  const button = appRoot.querySelector<HTMLButtonElement>('[data-view="messages"]');
  button?.classList.toggle('has-unread', unread);
  button?.setAttribute('aria-label', unread ? 'Messages, unread messages' : 'Messages');
  const icon = button?.querySelector<HTMLImageElement>('.nav-icon');
  if (icon) icon.src = (unread ? icon.dataset.alertIcon : icon.dataset.normalIcon) || icon.src;
  const recipient = activeView === 'messages' ? messageRecipient : undefined;
  if (!recipient || markingRead.has(recipient) || !messages.some((message) => message.unread && isVisibleInConversation(message, recipient))) return;
  markingRead.add(recipient);
  void window.aprsbox.messages.markRead(recipient).then(() => {
    markingRead.delete(recipient);
    syncMessageUnread();
  }).catch((error) => { markingRead.delete(recipient); console.error(error); });
}

function updateMessages(next: AprsMessage[]): void {
  const oldIds = new Set(messages.map((message) => message.id));
  const hasNewMessage = !!messageRecipient && next.some((message) => !oldIds.has(message.id) && isVisibleInConversation(message, messageRecipient!));
  messages = next;
  syncMessageUnread();
  if (activeView !== 'messages') return;
  const history = appRoot.querySelector<HTMLElement>('[data-message-history]');
  if (history && messageRecipient) {
    const atBottom =
      history.scrollHeight - history.scrollTop - history.clientHeight < 32;
    history.innerHTML = renderMessageHistory(messages, messageRecipient);
    if (atBottom || hasNewMessage) history.scrollTop = history.scrollHeight;
  }
  const list = appRoot.querySelector<HTMLElement>('.messages-conversations');
  if (list) {
    const template = document.createElement('template');
    template.innerHTML = renderMessagesView(
      messages,
      messageRecipient,
      interfaces,
      interfaceStatuses,
      messageInterfaceId,
      messageRecipient ? messagePaths[messageRecipient] ?? '' : '',
      messageGroups,
    ).html;
    list.innerHTML =
      template.content.querySelector('.messages-conversations')?.innerHTML ??
      '';
  }
}

function renderApp(): void {
  const previousHistory = mountedView === 'messages' && activeView === 'messages' && mountedMessageRecipient === messageRecipient
    ? appRoot.querySelector<HTMLElement>('[data-message-history]') : null;
  const previousScrollTop = previousHistory?.scrollTop;
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
  appRoot.innerHTML = `<div class="app-shell">${createSidebar(activeView, messages.some((message) => message.unread))}<div class="workspace">${createTopbar(activeView, mapTools, themeMode, activeSettingsSection, activeProfile()?.station.callsign ? `${activeProfile()!.station.callsign}${activeProfile()!.station.ssid}` : 'No callsign', mapMaskOpacity[resolvedTheme], detailCallsign ? '' : renderStationFilters(liveStations, stationsViewState.filter), interfaces, interfaceStatuses, activeView === 'traffic' ? renderTrafficFilter(trafficFrames, trafficFilter) : '', activeView === 'stations' && !detailCallsign ? renderStationSearch(liveStations, stationsViewState) : '', activeProfileLabel())}<main class="content-area"><section class="view-region" aria-live="polite">${page.html}</section>${mapDrawer}</main></div></div>${locationPickerOpen && locationPickerCenter ? createLocationPicker(locationPickerCenter) : ''}${createAlertDialog(alertMessage)}${createConfirmDialog(confirmation)}${renderProfileDialog(profileDialog)}`;
  if (profileBusy) appRoot.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('.settings-view input, .settings-view select, .settings-view button, [data-action="send-beacon"], [data-topbar-interface]').forEach((control) => { control.disabled = true; });
  appRoot.querySelector<HTMLSelectElement>('[data-profile-select]')?.addEventListener('change', (event) => {
    const id = (event.currentTarget as HTMLSelectElement).value;
    const index = stationProfiles.findIndex((profile) => profile.id === id);
    if (id === activeProfileId || index < 0) return;
    pendingProfileSwitch = id;
    confirmation = { kind: 'switch-profile', title: 'Switch profile?', message: `Switch to ${profileLabel(stationProfiles[index], index)}? Pending transmissions will be cancelled.` };
    renderApp();
  });
  appRoot.querySelectorAll<HTMLButtonElement>('[data-profile-action]').forEach((button) => button.addEventListener('click', () => {
    if (profileBusy) return;
    const action = button.dataset.profileAction as ProfileAction['action'];
    if (action === 'delete') {
      confirmation = { kind: 'profile', title: 'Delete profile?', message: `Delete “${activeProfileLabel() || activeProfile()?.name}”? Another profile will become active. Hardware interfaces are kept.` };
    } else if (action === 'create' || action === 'duplicate' || action === 'rename') {
      profileDialog = { action, name: action === 'create' ? '' : action === 'duplicate' ? `${activeProfile()?.name} copy` : activeProfile()?.name ?? '' };
    }
    renderApp();
    appRoot.querySelector<HTMLInputElement>('[data-profile-name]')?.focus();
  }));
  appRoot.querySelector<HTMLInputElement>('[data-profile-name]')?.addEventListener('input', (event) => {
    if (profileDialog) profileDialog.name = (event.currentTarget as HTMLInputElement).value;
  });
  appRoot.querySelector('[data-action="cancel-profile-dialog"]')?.addEventListener('click', () => { profileDialog = undefined; renderApp(); });
  appRoot.querySelector('[data-action="cancel-delete-profile"]')?.addEventListener('click', () => { confirmation = undefined; renderApp(); });
  appRoot.querySelector('[data-action="cancel-switch-profile"]')?.addEventListener('click', () => { pendingProfileSwitch = undefined; confirmation = undefined; renderApp(); });
  appRoot.querySelector('[data-action="confirm-switch-profile"]')?.addEventListener('click', () => {
    const id = pendingProfileSwitch;
    pendingProfileSwitch = undefined;
    if (id) void changeProfile({ action: 'select', id });
  });
  appRoot.querySelector('[data-action="confirm-delete-profile"]')?.addEventListener('click', () => { void changeProfile({ action: 'delete', id: activeProfileId }); });
  updateSidebarClock();
  updateBleDevices();
  if (activeView === 'messages' && messageRecipient) {
    const history = appRoot.querySelector<HTMLElement>('[data-message-history]');
    if (history) history.scrollTop = previousScrollTop ?? history.scrollHeight;
  }
  const pathInput = appRoot.querySelector<HTMLInputElement>('[data-message-send] input[name="path"]');
  const pathRecipient = messageRecipient;
  const pathProfileId = activeProfileId;
  if (pathInput && pathRecipient) {
    const savePath = () => {
      clearTimeout(messagePathTimers.get(pathRecipient));
      messagePathTimers.delete(pathRecipient);
      void window.aprsbox.config.saveMessagePath(pathRecipient, messagePaths[pathRecipient] ?? '', pathProfileId).catch((error) => {
        const output = appRoot.querySelector<HTMLElement>('[data-message-error]');
        if (output && messageRecipient === pathRecipient) output.textContent = `Could not save path: ${String(error)}`;
      });
    };
    pathInput.addEventListener('input', () => {
      messagePaths[pathRecipient] = pathInput.value;
      modifiedMessagePaths.add(pathRecipient);
      clearTimeout(messagePathTimers.get(pathRecipient));
      messagePathTimers.set(pathRecipient, setTimeout(savePath, 500));
    });
    pathInput.addEventListener('change', savePath);
  }
  appRoot.querySelector<HTMLSelectElement>('[data-message-send] select[name="interfaceId"]')?.addEventListener('change', (event) => {
    messageInterfaceId = (event.currentTarget as HTMLSelectElement).value;
    messageInterfaceChanged = true;
    void window.aprsbox.config.saveMessageInterface(messageInterfaceId, activeProfileId).catch((error) => {
      const output = appRoot.querySelector<HTMLElement>('[data-message-error]');
      if (output) output.textContent = `Could not save interface selection: ${String(error)}`;
    });
  });
  appRoot.querySelector<HTMLButtonElement>('[data-action="ble-scan"]')?.addEventListener('click', () => {
    if (!interfaceDraft.id) interfaceDraft.id = crypto.randomUUID();
    const interfaceId = interfaceDraft.id;
    if (bleAutoTarget === interfaceId && isBleScanning(interfaceId)) { bleAutoTarget = undefined; bleScanMessage = 'Scanning for Bluetooth devices…'; updateBleDevices(); return; }
    bleDevices = []; bleSelectedDeviceId = ''; updateBleDevices();
    try {
      scanBle(interfaceId, interfaceDraft.reconnectTimeout, (message) => { bleScanMessage = message; updateBleDevices(); });
      bleScanInterfaceId = interfaceId;
    }
    catch (error) { alertMessage = { title: 'Bluetooth unavailable', message: String(error), tone: 'error' }; renderApp(); }
  });
  const bleDeviceList = appRoot.querySelector<HTMLSelectElement>('[data-ble-devices]');
  bleDeviceList?.addEventListener('change', () => { bleSelectedDeviceId = bleDeviceList.value; });
  bleDeviceList?.addEventListener('blur', updateBleDevices);
  appRoot.querySelector<HTMLButtonElement>('[data-action="ble-select"]')?.addEventListener('click', () => {
    const id = bleSelectedDeviceId;
    if (!id) return;
    if (!bleDevices.some((device) => device.id === id) || !bleScanInterfaceId || !isBleScanning(bleScanInterfaceId)) {
      bleScanMessage = 'Device is no longer available. Scan again.'; updateBleDevices(); return;
    }
    const saved = interfaces.find((item) => item.id === bleScanInterfaceId);
    if (!saved?.enabled || saved.type !== 'kiss-ble' || interfaceDraft.id !== saved.id) {
      bleScanMessage = 'Save and enable this Bluetooth interface before connecting.';
      updateBleDevices();
      return;
    }
    chooseBleDevice(saved.id, id); bleDevices = [];
  });
  appRoot.querySelector<HTMLButtonElement>('[data-action="ble-cancel"]')?.addEventListener('click', () => { bleAutoTarget = undefined; cancelBleScan(); bleDevices = []; bleSelectedDeviceId = ''; updateBleDevices(); });
  appRoot.querySelector<HTMLButtonElement>('[data-action="ble-disconnect"]')?.addEventListener('click', () => { if (selectedInterfaceId) disconnectBle(selectedInterfaceId); });
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
        changedMapTools.add(tool);
        void window.aprsbox.config.saveMapTool(tool, mapTools[tool]).catch(console.error);
        if (tool === 'scroller') {
          scrollerChangeRevision++;
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
        const result = await window.aprsbox.config.sendBeacon({ ...stationSettings }, activeProfileId);
        alertMessage = {
          title: result.failed.length ? 'Beacon partially sent' : 'Beacon sent',
          message: `Sent: ${result.sent.join(', ')}.${result.failed.length ? ` Failed: ${result.failed.join('; ')}` : ''}`,
          tone: result.failed.length ? 'error' : 'success',
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
  appRoot.querySelector<HTMLButtonElement>('[data-action="send-status"]')?.addEventListener('click', async (event) => {
    if (statusSending || profileBusy) return;
    statusSending = true;
    (event.currentTarget as HTMLButtonElement).disabled = true;
    try {
      const result = await window.aprsbox.config.sendStatus({ ...stationSettings }, activeProfileId);
      alertMessage = {
        title: result.failed.length ? 'Status partially sent' : 'Status sent',
        message: `Sent: ${result.sent.join(', ')}.${result.failed.length ? ` Failed: ${result.failed.join('; ')}` : ''}`,
        tone: result.failed.length ? 'error' : 'success',
      };
    } catch (error) {
      alertMessage = { title: 'Status not sent', message: error instanceof Error ? error.message : String(error), tone: 'error' };
    } finally {
      statusSending = false;
      renderApp();
    }
  });
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
          name: interfaceDraft.name.trim() || (interfaceDraft.type === 'aprs-is' ? 'APRS-IS' : 'KISS interface'),
          ...(interfaceDraft.type === 'aprs-is' && interfaceDraft.aprsIsFilter === undefined ? { aprsIsFilter: defaultAprsIsFilter(stationSettings.location, interfaceDraft.aprsIsRadius || '25') } : {}),
        };
        const nextInterfaces = selectedInterfaceId
          ? interfaces.map((item) =>
              item.id === selectedInterfaceId ? savedInterface : item,
            )
          : [...interfaces, savedInterface];
        try {
          await window.aprsbox.config.saveInterfaces(nextInterfaces, activeProfileId);
          interfaces = nextInterfaces;
          reconcileBle(interfaces);
          selectedInterfaceId = savedInterface.id;
          interfaceDraft = { ...savedInterface };
          if (savedInterface.type === 'kiss-ble' && savedInterface.enabled && savedInterface.id === bleScanInterfaceId && isBleScanning(savedInterface.id) && bleDevices.some((device) => device.id === bleSelectedDeviceId)) {
            chooseBleDevice(savedInterface.id, bleSelectedDeviceId);
            bleDevices = [];
          }
          alertMessage = {
            title: 'Interface saved',
            message:
              'Interface configuration was saved to the active configuration file.',
            tone: 'success',
          };
        } catch (error) {
          alertMessage = {
            title: 'Save failed',
            message: error instanceof Error ? error.message : String(error),
            tone: 'error',
          };
        }
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="toggle-interface"]')
    .forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.interfaceId) void toggleInterface(button.dataset.interfaceId);
    }));
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
          await window.aprsbox.config.saveInterfaces(nextInterfaces, activeProfileId);
          interfaces = nextInterfaces;
          reconcileBle(interfaces);
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
  appRoot.querySelector<HTMLButtonElement>('[data-action="cancel-delete-conversation"]')?.addEventListener('click', () => {
    confirmation = undefined; pendingConversationDeletion = undefined; renderApp();
  });
  appRoot.querySelector<HTMLButtonElement>('[data-action="confirm-delete-conversation"]')?.addEventListener('click', async () => {
    const recipient = pendingConversationDeletion;
    if (!recipient) return;
    try {
      await window.aprsbox.messages.deleteConversation(recipient);
      if (messageRecipient === recipient) messageRecipient = undefined;
    } catch {
      alertMessage = { title: 'Delete failed', message: 'The conversation could not be deleted.', tone: 'error' };
    }
    confirmation = undefined; pendingConversationDeletion = undefined; renderApp();
  });
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
          await window.aprsbox.config.saveStation(stationSettings, activeProfileId);
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
    .querySelectorAll<HTMLButtonElement>('[data-action="open-location-picker"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        locationPickerCenter = parseCoordinates(stationSettings.location) ??
          (mapViewport ? { latitude: mapViewport.latitude, longitude: mapViewport.longitude } : { latitude: 50.055, longitude: 19.97 });
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
  mountedMessageRecipient = activeView === 'messages' ? messageRecipient : undefined;
  syncMessageUnread();
}

applyTheme();
window.aprsbox.messages.onReceived(() => { void playMessageSound().catch(console.error); });
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

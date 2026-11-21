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
import { createTopbar } from './components/Topbar';
import type { MapToolId, MapToolState, ThemeMode } from './components/Topbar';
import { createRightPanel, renderLastPacket } from './components/RightPanel';
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
import { renderStationDetails, renderStationsView } from './views/StationsView';
import { renderTrafficMonitorView } from './views/TrafficMonitorView';
import type { TrafficMonitorFrame } from './views/TrafficMonitorView';
import type { AppView, Station, AprsMessage } from './types';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) throw new Error('Could not find the app root element.');

const appRoot = root;

let activeView: AppView = 'map';
let selectedCallsign: string | undefined;
let detailCallsign: string | undefined;
let messageRecipient: string | undefined;
let messages: AprsMessage[] = [];
let liveStations: Station[] = [];
let updateStationMarkers: ((stations: Station[]) => void) | undefined;
let mapViewport: MapViewport | undefined;
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
  scroller: false,
  ruler: false,
  grid: false,
};
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

async function loadConfiguration(): Promise<void> {
  try {
    const configuration = await window.aprsbox.config.get();
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
    const packetBox = appRoot.querySelector('.last-heard-packet');
    if (packetBox)
      packetBox.outerHTML = renderLastPacket(
        trafficFrames[0],
        liveStations,
        parseCoordinates(stationSettings.location),
      );
    refreshPacketScroller();
    if (activeView === 'traffic' || activeView === 'settings') renderApp();
  } catch {
    // Traffic is live-only; an unavailable Main Process leaves the monitor empty.
  }
}

window.aprsbox.traffic.onReceived((frame) => {
  trafficFrames = [frame, ...trafficFrames].slice(0, 1_000);
  const packetBox = appRoot.querySelector('.last-heard-packet');
  if (packetBox)
    packetBox.outerHTML = renderLastPacket(
      frame,
      liveStations,
      parseCoordinates(stationSettings.location),
    );
  refreshPacketScroller();
  if (activeView === 'traffic') renderApp();
});

window.aprsbox.traffic.onInterfaceStatus(({ interfaceId, status }) => {
  interfaceStatuses = { ...interfaceStatuses, [interfaceId]: status };
  if (activeView === 'settings') renderApp();
  if (activeView === 'messages') {
    const option = [
      ...appRoot.querySelectorAll<HTMLOptionElement>(
        'select[name="interfaceId"] option',
      ),
    ].find((item) => item.value === interfaceId);
    const configured = interfaces.find((item) => item.id === interfaceId);
    if (option && configured) {
      option.disabled = status !== 'connected';
      option.textContent = `${configured.name || configured.hostPort} · ${status}`;
    }
  }
});

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
    return station
      ? renderStationDetails(
          station,
          parseCoordinates(stationSettings.location),
        )
      : renderStationsView(liveStations);
  },
  traffic: () => renderTrafficMonitorView(trafficFrames),
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
    ),
};

function renderMapDrawer(): string {
  return activeView === 'map' && (mapTools.scroller || mapTools.packet)
    ? createRightPanel({
        station: liveStations.find(
          (station) => station.callsign === selectedCallsign,
        ),
        latestPacket: trafficFrames[0],
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

setInterval(() => {
  if (activeView === 'map' && mapTools.scroller) refreshPacketScroller();
}, 60_000);

function receiveStations(stations: Station[]): void {
  liveStations = stations;
  if (!stations.some((station) => station.callsign === selectedCallsign)) {
    selectedCallsign = undefined;
  }
  updateStationMarkers?.(stations);
  const drawer = appRoot.querySelector('.right-panel');
  if (drawer) {
    const scrollTop = drawer.querySelector('.station-scroll')?.scrollTop ?? 0;
    drawer.outerHTML = renderMapDrawer();
    const scroll = appRoot.querySelector<HTMLElement>('.station-scroll');
    if (scroll) scroll.scrollTop = scrollTop;
  }
  if (activeView === 'stations') {
    const view = appRoot.querySelector('.view-region');
    const station = stations.find((item) => item.callsign === detailCallsign);
    if (view)
      view.innerHTML = (
        station
          ? renderStationDetails(
              station,
              parseCoordinates(stationSettings.location),
            )
          : renderStationsView(stations)
      ).html;
  }
}

appRoot.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
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
  const stationButton =
    event.target.closest<HTMLButtonElement>('[data-station]');
  if (stationButton) {
    selectedCallsign = stationButton.dataset.station;
    const drawer = appRoot.querySelector('.right-panel');
    if (drawer) drawer.outerHTML = renderMapDrawer();
  }
  if (event.target.closest('.right-panel [data-tool="scroller"]')) {
    mapTools.scroller = false;
    renderApp();
  }
});

appRoot.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
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
  appRoot.innerHTML = `<div class="app-shell">${createSidebar(activeView)}<div class="workspace">${createTopbar(activeView, mapTools, themeMode, activeSettingsSection, `${stationSettings.callsign}${stationSettings.ssid}`, mapMaskOpacity[resolvedTheme])}<main class="content-area"><section class="view-region" aria-live="polite">${page.html}</section>${mapDrawer}</main></div></div>${locationPickerOpen && locationPickerCenter ? createLocationPicker(locationPickerCenter) : ''}${createAlertDialog(alertMessage)}${createConfirmDialog(confirmation)}`;
  if (existingMap) {
    appRoot.querySelector('.view-region')?.replaceWith(existingMap);
    window.dispatchEvent(new Event('aprs-map:visible'));
  }
  if (locationPickerOpen && locationPickerCenter) {
    mountedLocationPicker = mountLocationPicker(appRoot, locationPickerCenter);
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
      '[data-tool]:not(.right-panel [data-tool])',
    )
    .forEach((button) =>
      button.addEventListener('click', () => {
        const tool = button.dataset.tool as MapToolId;
        mapTools[tool] = !mapTools[tool];
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

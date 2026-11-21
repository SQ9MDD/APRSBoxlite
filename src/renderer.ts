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
import { createRightPanel } from './components/RightPanel';
import { latestPacket, mockStations } from './data/mockData';
import { renderMapView } from './views/MapView';
import { renderMessagesView } from './views/MessagesView';
import {
  renderSettingsView,
  type PhgValues,
  type InterfaceSettings,
  type SettingsSection,
  type StationSettings,
} from './views/SettingsView';
import { renderStationsView } from './views/StationsView';
import { renderTrafficMonitorView } from './views/TrafficMonitorView';
import type { TrafficMonitorFrame } from './views/TrafficMonitorView';
import type { AppView, Station } from './types';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) throw new Error('Could not find the app root element.');

const appRoot = root;

let activeView: AppView = 'map';
let selectedStation: Station | undefined;
let activeSettingsSection: SettingsSection = 'general';
let selectedInterfaceId: string | undefined;
let interfaces: InterfaceSettings[] = [];
let interfaceDraft: InterfaceSettings = createInterfaceDraft();
let themeMode: ThemeMode = 'system';
let themeMenuOpen = false;
let stationSettings: StationSettings = {
  callsign: 'SQ9MDD',
  ssid: '-8',
  location: '50.0619, 19.9383',
  comment: 'APRSBox Lite station',
  status: 'Monitoring APRS traffic',
  beaconInterval: '15 minutes',
  statusInterval: '30 minutes',
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
    applyStoredStationConfiguration(configuration);
    applyStoredInterfaces(configuration);
    renderApp();
  } catch {
    // The UI remains usable with its in-memory defaults if configuration is unavailable.
  }
}

async function loadTraffic(): Promise<void> {
  try {
    [trafficFrames, interfaceStatuses] = await Promise.all([
      window.aprsbox.traffic.getRecent(),
      window.aprsbox.traffic.getInterfaceStatuses(),
    ]);
    if (activeView === 'traffic' || activeView === 'settings') renderApp();
  } catch {
    // Traffic is live-only; an unavailable Main Process leaves the monitor empty.
  }
}

window.aprsbox.traffic.onReceived((frame) => {
  trafficFrames = [frame, ...trafficFrames].slice(0, 1_000);
  if (activeView === 'traffic') renderApp();
});

window.aprsbox.traffic.onInterfaceStatus(({ interfaceId, status }) => {
  interfaceStatuses = { ...interfaceStatuses, [interfaceId]: status };
  if (activeView === 'settings') renderApp();
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
      stations: mockStations,
      resetCenter: (() => {
        const coordinates = parseCoordinates(stationSettings.location);
        return coordinates
          ? ([coordinates.latitude, coordinates.longitude] as [number, number])
          : ([50.055, 19.97] as [number, number]);
      })(),
      onStationSelected: (station) => {
        selectedStation = station;
        mapTools.scroller = true;
        renderApp();
      },
    }),
  stations: () => renderStationsView(mockStations),
  traffic: () => renderTrafficMonitorView(trafficFrames),
  messages: () => renderMessagesView(),
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

function renderApp(): void {
  disposeCurrentView?.();
  mountedLocationPicker?.dispose();
  mountedLocationPicker = undefined;
  const page = pageRenderers[activeView]();
  const mapDrawer =
    activeView === 'map' && mapTools.scroller
      ? createRightPanel({
          station: selectedStation,
          latestPacket,
          stations: mockStations,
          showLatestPacket: mapTools.packet,
        })
      : '';
  appRoot.innerHTML = `<div class="app-shell">${createSidebar(activeView)}<div class="workspace">${createTopbar(activeView, mapTools, themeMode, themeMenuOpen, activeSettingsSection, `${stationSettings.callsign}${stationSettings.ssid}`)}<main class="content-area"><section class="view-region" aria-live="polite">${page.html}</section>${mapDrawer}</main></div></div>${locationPickerOpen && locationPickerCenter ? createLocationPicker(locationPickerCenter) : ''}${createAlertDialog(alertMessage)}${createConfirmDialog(confirmation)}`;
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
      activeView = button.dataset.view as AppView;
      renderApp();
    }),
  );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-station]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        const station = mockStations.find(
          (item) => item.callsign === button.dataset.station,
        );
        if (station) {
          selectedStation = station;
          renderApp();
        }
      }),
    );
  appRoot.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) =>
    button.addEventListener('click', () => {
      const tool = button.dataset.tool as MapToolId;
      mapTools[tool] = !mapTools[tool];
      renderApp();
    }),
  );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-action="toggle-theme-menu"]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        themeMenuOpen = !themeMenuOpen;
        renderApp();
      }),
    );
  appRoot
    .querySelectorAll<HTMLButtonElement>('[data-theme]')
    .forEach((button) =>
      button.addEventListener('click', () => {
        themeMode = button.dataset.theme as ThemeMode;
        themeMenuOpen = false;
        applyTheme();
        renderApp();
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
  disposeCurrentView =
    viewRoot && page.mount ? page.mount(viewRoot) : undefined;
}

applyTheme();
renderApp();
void loadConfiguration();
void loadTraffic();

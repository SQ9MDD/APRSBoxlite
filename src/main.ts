import { activeStationProfile, applyProfileAction, normalizeProfileConfiguration, patchProfileConfiguration, runtimeConfiguration, type ProfileAction, type ProfileConfiguration } from './stationProfiles';
import { availableMessageInterfaces, sendMessageOnInterfaces } from './main/messageTransport';
import { appendAprsIsGroups, readMessageGroups } from './messageGroups';
import { defaultAprsIsFilter, validAprsIsFilter } from './aprsIsFilter';
import { app, BrowserWindow, dialog, ipcMain, net, powerMonitor, protocol, session, shell } from 'electron';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { StationStore } from './main/stationStore';
import { MessageService } from './main/aprsMessages';
import { MessageStorage } from './main/messageStorage';
import { encodeBeacon, encodeStatus, selectBeaconInterfaces, transmitBeacon } from './main/aprsBeacon';
import { classifyTraffic } from './main/trafficColors';
import type { Station, AprsMessage } from './types';
import { ConfigStorage, getApplicationDirectory, atomicWriteJson } from './main/configStorage';
import { DEFAULT_MAP_SETTINGS, validateMapSettings } from './mapSettings';
import { MapTileCache } from './main/mapTileCache';
import { createStatusScheduler } from './main/statusScheduler';
import { createConfigurationBackup, readConfigurationBackup } from './main/configBackup';
import { filterTrafficFrames, formatTrafficLog, trafficLogFilename } from './trafficLog';
import { KissSerialRxService } from './main/kissSerialRx';
import { KissBleRxService } from './main/kissBleRx';
import { loadSavedTocalls, updateTocalls } from './main/tocallUpdate';
import { AprsIsRxService } from './main/aprsIsRx';
import {
  KissTcpRxService,
  KissFrameDecoder,
  type ConnectionStatus,
  type TrafficFrame,
} from './main/kissTcpRx';

interface StationConfiguration {
  callsign: string;
  ssid: string;
  location: string;
  comment: string;
  status: string;
  beaconInterval: string;
  statusInterval: string;
  symbolTable: string;
  symbolCode: string;
  symbolOverlay: string;
  beaconPath: string;
  beaconInterfaceId: string;
}

interface InterfaceConfiguration {
  id: string;
  name: string;
  type: 'kiss-tcp' | 'kiss-serial' | 'kiss-ble' | 'aprs-is';
  enabled: boolean;
  txBlocked: boolean;
  hostPort: string;
  serialDevice: string;
  baudRate: string;
  reconnectTimeout: string;
  bleProfile?: 'rt-950-pro';
  bleDeviceId?: string;
  bleDeviceName?: string;
  aprsIsServer?: string;
  aprsIsRadius?: string;
  aprsIsFilter?: string;
  aprsIsPasscode?: string;
  aprsIsIgateRfToIs?: boolean;
}

const existingUserDataDirectory = app.getPath('userData');
app.setName('APRSBOX');
mkdirSync(existingUserDataDirectory, { recursive: true });
app.setPath('userData', existingUserDataDirectory);

protocol.registerSchemesAsPrivileged([{ scheme: 'aprsbox-tile', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function applicationIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'aprsbox.png')
    : path.join(app.getAppPath(), 'assets', 'aprsbox.png');
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: 'APRSBOX',
    icon: applicationIconPath(),
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let chooseBluetooth: ((id: string) => void) | undefined;
  let availableBluetooth = new Set<string>();
  let cancelBluetooth = false;
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    if (cancelBluetooth) { cancelBluetooth = false; callback(''); return; }
    chooseBluetooth = callback;
    availableBluetooth = new Set(devices.map((device) => device.deviceId));
    mainWindow.webContents.send('ble:devices', devices.map(({ deviceId, deviceName }) => ({ id: deviceId, name: deviceName })));
  });
  const selectDevice = (event: Electron.IpcMainEvent, id: unknown) => {
    if (event.sender !== mainWindow.webContents || typeof id !== 'string' || (id && !availableBluetooth.has(id))) return;
    const callback = chooseBluetooth; chooseBluetooth = undefined; availableBluetooth.clear();
    if (!callback && !id) cancelBluetooth = true;
    callback?.(id);
  };
  const beginBluetooth = (event: Electron.IpcMainEvent) => { if (event.sender === mainWindow.webContents) cancelBluetooth = false; };
  ipcMain.on('ble:begin', beginBluetooth);
  ipcMain.on('ble:choose', selectDevice);
  mainWindow.on('closed', () => { chooseBluetooth?.(''); ipcMain.removeListener('ble:begin', beginBluetooth); ipcMain.removeListener('ble:choose', selectDevice); });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

let configStorage: ConfigStorage;
const storedConfiguration = () => configStorage.getConfiguration() as ProfileConfiguration;
const getConfiguration = () => runtimeConfiguration(storedConfiguration());
let kissTcpRxService: KissTcpRxService;
let kissSerialRxService: KissSerialRxService;
let aprsIsRxService: AprsIsRxService;
let messageService: MessageService;
let messageStorage: MessageStorage | undefined;
let beaconTimer: ReturnType<typeof setTimeout> | undefined;
let statusScheduler: ReturnType<typeof createStatusScheduler> | undefined;
const stationStore = new StationStore((stations) =>
  broadcast('stations:changed', stations),
);

function broadcast(
  channel: string,
  payload:
    | TrafficFrame
    | Station[]
    | AprsMessage[]
    | {
        interfaceId: string;
        status: ConnectionStatus;
      },
): void {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (!browserWindow.isDestroyed())
      browserWindow.webContents.send(channel, payload);
  }
}

function validateStationConfiguration(value: unknown): StationConfiguration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid station configuration.');
  }
  const source = value as Record<string, unknown>;
  const getText = (
    key: keyof StationConfiguration,
    maximum: number,
  ): string => {
    const field = source[key];
    if (typeof field !== 'string') throw new Error(`Invalid ${key}.`);
    return field.trim().slice(0, maximum);
  };
  const ssid = getText('ssid', 3);
  if (!/^-(?:[0-9]|1[0-5])$/.test(ssid)) {
    throw new Error('Invalid SSID.');
  }
  const location = getText('location', 80);
  const coordinates = location.match(
    /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/,
  );
  if (!coordinates) throw new Error('Invalid location.');
  const latitude = Number(coordinates[1]);
  const longitude = Number(coordinates[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error('Invalid location.');
  }
  const symbolTable =
    source.symbolTable === undefined ? '/' : getText('symbolTable', 1);
  const symbolCode =
    source.symbolCode === undefined ? '>' : getText('symbolCode', 1);
  const symbolOverlay =
    source.symbolOverlay === undefined
      ? ''
      : getText('symbolOverlay', 1).toUpperCase();
  const beaconPath =
    source.beaconPath === undefined
      ? ''
      : getText('beaconPath', 71).toUpperCase();
  const beaconInterfaceId =
    source.beaconInterfaceId === undefined
      ? ''
      : getText('beaconInterfaceId', 80);
  if (
    !['/', '\\'].includes(symbolTable) ||
    !/^[!-~]$/.test(symbolCode) ||
    (symbolOverlay !== '' &&
      (symbolTable !== '\\' || !/^[A-Z0-9]$/.test(symbolOverlay)))
  )
    throw new Error('Invalid APRS symbol.');
  return {
    callsign: getText('callsign', 9).toUpperCase(),
    ssid,
    location: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    comment: getText('comment', 36),
    status: getText('status', 62),
    beaconInterval: getText('beaconInterval', 32),
    statusInterval: getText('statusInterval', 32),
    symbolTable,
    symbolCode,
    symbolOverlay,
    beaconPath,
    beaconInterfaceId,
  };
}

function validateInterfaces(value: unknown): InterfaceConfiguration[] {
  if (!Array.isArray(value))
    throw new Error('Invalid interface configuration.');
  if (value.length > 32) throw new Error('Too many interfaces.');
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Invalid interface at index ${index}.`);
    }
    const source = item as Record<string, unknown>;
    const text = (
      key: keyof InterfaceConfiguration,
      maximum: number,
    ): string => {
      const field = source[key];
      if (typeof field !== 'string') throw new Error(`Invalid ${key}.`);
      return field.trim().slice(0, maximum);
    };
    const type = text('type', 16);
    if (type !== 'kiss-tcp' && type !== 'kiss-serial' && type !== 'kiss-ble' && type !== 'aprs-is') {
      throw new Error('Unsupported interface type.');
    }
    if (
      typeof source.enabled !== 'boolean' ||
      typeof source.txBlocked !== 'boolean'
    ) {
      throw new Error('Invalid interface state.');
    }
    if (type === 'aprs-is') {
      const server = typeof source.aprsIsServer === 'string' ? source.aprsIsServer.trim() : 'rotate.aprs2.net:14580';
      const address = server.match(/^([^\s:]+):(\d{1,5})$/);
      const radius = Number(typeof source.aprsIsRadius === 'string' ? source.aprsIsRadius : '25');
      const passcode = typeof source.aprsIsPasscode === 'string' ? source.aprsIsPasscode.trim() : '';
      if (!address || Number(address[2]) < 1 || Number(address[2]) > 65535) throw new Error('Invalid APRS-IS server or port.');
      if (!Number.isFinite(radius) || radius <= 0 || radius > 10000) throw new Error('Invalid APRS-IS range.');
      if (source.aprsIsFilter !== undefined && (typeof source.aprsIsFilter !== 'string' || !validAprsIsFilter(source.aprsIsFilter))) throw new Error('Invalid APRS-IS filter.');
      if (passcode && !/^(?:-1|\d{1,5})$/.test(passcode)) throw new Error('Invalid APRS-IS passcode.');
      if (source.aprsIsIgateRfToIs !== undefined && typeof source.aprsIsIgateRfToIs !== 'boolean') throw new Error('Invalid iGate setting.');
    }
    return {
      id: text('id', 80),
      name: text('name', 80),
      type,
      enabled: source.enabled,
      txBlocked: source.txBlocked,
      hostPort: text('hostPort', 255),
      serialDevice: text('serialDevice', 255),
      baudRate: text('baudRate', 16),
      reconnectTimeout: text('reconnectTimeout', 16),
      ...(type === 'kiss-ble' ? { bleProfile: 'rt-950-pro' as const } : {}),
      ...(type === 'kiss-ble' && typeof source.bleDeviceId === 'string' ? { bleDeviceId: text('bleDeviceId', 255) } : {}),
      ...(type === 'kiss-ble' && typeof source.bleDeviceName === 'string' ? { bleDeviceName: text('bleDeviceName', 255) } : {}),
      ...(type === 'aprs-is' ? { aprsIsServer: typeof source.aprsIsServer === 'string' ? text('aprsIsServer', 255) : 'rotate.aprs2.net:14580', aprsIsRadius: typeof source.aprsIsRadius === 'string' ? text('aprsIsRadius', 16) : '25', ...(typeof source.aprsIsFilter === 'string' ? { aprsIsFilter: source.aprsIsFilter.trim() } : {}), aprsIsPasscode: typeof source.aprsIsPasscode === 'string' ? text('aprsIsPasscode', 6) : '', aprsIsIgateRfToIs: source.aprsIsIgateRfToIs === true } : {}),
    };
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(applicationIconPath());
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'geolocation',
  );
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === 'geolocation');
    },
  );
  const applicationDirectory = getApplicationDirectory({
    appPath: app.getAppPath(),
    executablePath: process.execPath,
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImagePath: process.env.APPIMAGE,
    portableExecutableDirectory: process.env.PORTABLE_EXECUTABLE_DIR,
  });
  configStorage = new ConfigStorage({
    applicationDirectory,
    userDataDirectory: app.getPath('userData'),
  });
  await configStorage.initialize();
  const originalConfiguration = configStorage.getConfiguration();
  const migratedConfiguration = normalizeProfileConfiguration(originalConfiguration);
  if (JSON.stringify(originalConfiguration) !== JSON.stringify(migratedConfiguration))
    await configStorage.save(migratedConfiguration);
  let switchingProfile = false;
  let transmissionGeneration = 0;
  const transmissions = new Set<Promise<void>>();
  const tocallPath = path.join(path.dirname(configStorage.getLocation().path), 'tocalls.json');
  try { await loadSavedTocalls(tocallPath); }
  catch (error) { console.error('Failed to load saved TOCALL database; using the bundled list:', error); }
  const tileCache = new MapTileCache(
    () => path.dirname(configStorage.getLocation().path),
    () => {
      try { return validateMapSettings(getConfiguration().mapSettings ?? DEFAULT_MAP_SETTINGS).sources; }
      catch { return DEFAULT_MAP_SETTINGS.sources; }
    },
    (url) => net.fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': `APRSBoxLite/${app.getVersion()}` } }),
  );
  protocol.handle('aprsbox-tile', (request) => tileCache.respond(request.url).catch((error) => {
    console.error('Map tile cache failed:', error);
    return new Response(null, { status: 500 });
  }));
  let storedMessages: AprsMessage[] = [];
  const historyStorage = new MessageStorage(app.getPath('userData'));
  try {
    storedMessages = await historyStorage.load();
    messageStorage = historyStorage;
  } catch (error) {
    console.error('Failed to load message history:', error);
    dialog.showErrorBox('Message history unavailable', 'The saved message history could not be read. It has been left unchanged, and new messages will not be saved in this session.');
  }
  let messageStorageErrorReported = false;
  const persistMessages = (messages: AprsMessage[]) => {
    if (!messageStorage) return;
    void messageStorage.save(messages).then(() => {
      messageStorageErrorReported = false;
    }).catch((error) => {
      console.error('Failed to save message history:', error);
      if (!messageStorageErrorReported) {
        messageStorageErrorReported = true;
        dialog.showErrorBox('Message history not saved', 'The message history could not be saved. Check that the application data folder is writable.');
      }
    });
  };
  const onKissFrame = (frame: TrafficFrame) => {
      const station = getConfiguration().station as { callsign?: unknown; ssid?: unknown } | undefined;
      if (typeof station?.callsign === 'string' && typeof station.ssid === 'string')
        frame.category = classifyTraffic(frame.packet, `${station.callsign}${station.ssid}`);
      broadcast('traffic:received', frame);
      if (frame.direction === 'rx') {
        stationStore.receive(frame.packet, frame.interfaceName, frame);
        if (frame.source === 'kiss' && !switchingProfile) aprsIsRxService.forwardRf(frame);
        messageService.receive(frame.packet, frame.interfaceId, !switchingProfile && (frame.source !== 'aprs-is' || aprsIsRxService.canTransmit(frame.interfaceId)));
      }
    };
  const onKissStatus = (interfaceId: string, status: ConnectionStatus) =>
    broadcast('traffic:interface-status', { interfaceId, status });
  kissTcpRxService = new KissTcpRxService(onKissFrame, onKissStatus);
  kissSerialRxService = new KissSerialRxService(onKissFrame, onKissStatus);
  aprsIsRxService = new AprsIsRxService(onKissFrame, onKissStatus, app.getVersion());
  const bleWrites = new Map<string, { sender: Electron.WebContents; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  ipcMain.on('ble:write-result', (event, requestId: unknown, error: unknown) => {
    if (typeof requestId !== 'string') return;
    const pending = bleWrites.get(requestId);
    if (!pending || event.sender !== pending.sender || (error !== null && typeof error !== 'string')) return;
    clearTimeout(pending.timer); bleWrites.delete(requestId);
    if (typeof error === 'string') pending.reject(new Error(error)); else pending.resolve();
  });
  const kissBleRxService = new KissBleRxService(onKissFrame, onKissStatus, (interfaceId, bytes) => new Promise<void>((resolve, reject) => {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (!window) { reject(new Error('Bluetooth connection is unavailable.')); return; }
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { bleWrites.delete(requestId); reject(new Error('Bluetooth write timed out.')); }, 60000);
    bleWrites.set(requestId, { sender: window.webContents, resolve, reject, timer });
    window.webContents.send('ble:write', { requestId, interfaceId, bytes });
  }));
  const getMessageGroups = () => {
    try { return readMessageGroups(getConfiguration().messageGroups); }
    catch { return readMessageGroups(undefined); }
  };
  const configureKiss = (interfaces: InterfaceConfiguration[]) => {
    const wired = interfaces.filter((item): item is InterfaceConfiguration & { type: 'kiss-tcp' | 'kiss-serial' } => item.type === 'kiss-tcp' || item.type === 'kiss-serial');
    kissTcpRxService.configure(wired);
    kissSerialRxService.configure(wired);
    kissBleRxService.configure(interfaces);
    aprsIsRxService.configure(interfaces, getConfiguration().station as { callsign?: unknown; ssid?: unknown; location?: unknown } | undefined, getMessageGroups().aprsIs);
  };
  ipcMain.on('ble:status', (event, id: unknown, status: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string' || !['connecting', 'connected', 'disconnected', 'error'].includes(String(status))) return;
    kissBleRxService.status(id, status as ConnectionStatus);
  });
  ipcMain.on('ble:receive', (event, id: unknown, bytes: unknown) => {
    if (BrowserWindow.fromWebContents(event.sender) && typeof id === 'string' && bytes instanceof Uint8Array) kissBleRxService.receive(id, bytes);
  });
  const transmitKiss = async (interfaceId: string, frame: Uint8Array): Promise<void> => {
    if (switchingProfile) throw new Error('Station profile is changing. Try again after the switch.');
    const transmission = aprsIsRxService.isConfigured(interfaceId)
      ? aprsIsRxService.transmit(interfaceId, frame)
      : kissBleRxService.isConfigured(interfaceId)
      ? kissBleRxService.transmit(interfaceId, frame)
      : kissSerialRxService.isConfigured(interfaceId)
      ? kissSerialRxService.transmit(interfaceId, frame)
      : kissTcpRxService.transmit(interfaceId, frame);
    transmissions.add(transmission);
    try { await transmission; } finally { transmissions.delete(transmission); }
  };
  const kissStatuses = () => ({ ...kissTcpRxService.getStatuses(), ...kissSerialRxService.getStatuses(), ...kissBleRxService.getStatuses(), ...aprsIsRxService.getStatuses() });
  const getAvailableMessageInterfaces = () => {
    const interfaces = validateInterfaces(getConfiguration().interfaces ?? []);
    const statuses = kissStatuses();
    return availableMessageInterfaces(interfaces, (item) => statuses[item.id] === 'connected' && (item.type !== 'aprs-is' || aprsIsRxService.canTransmit(item.id)));
  };
  const transmitMessage = async (interfaceId: string, frame: Uint8Array) => {
    if (interfaceId) return transmitKiss(interfaceId, frame);
    const failures = await sendMessageOnInterfaces(getAvailableMessageInterfaces(), frame, transmitKiss);
    if (failures.length) console.warn('Message not sent on some interfaces:', failures.map(({ interface: item, error }) => `${item.name || item.id}: ${error}`).join('; '));
  };
  const kissHistory = () => [...kissTcpRxService.getHistory(), ...kissSerialRxService.getHistory(), ...kissBleRxService.getHistory(), ...aprsIsRxService.getHistory()]
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, 1000);
  const notifyPower = (event: 'system:suspend' | 'system:resume') => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(event);
    }
  };
  powerMonitor.on('suspend', () => notifyPower('system:suspend'));
  powerMonitor.on('resume', () => {
    kissTcpRxService.reconnectAfterResume();
    kissSerialRxService.reconnectAfterResume();
    aprsIsRxService.reconnectAfterResume();
    statusScheduler?.schedule();
    notifyPower('system:resume');
  });
  messageService = new MessageService(
    () => {
      const station = getConfiguration().station as
        | { callsign?: unknown; ssid?: unknown }
        | undefined;
      if (
        typeof station?.callsign !== 'string' ||
        typeof station.ssid !== 'string'
      )
        throw new Error('Configure and save My Station first.');
      return `${station.callsign}${station.ssid}`;
    },
    transmitMessage,
    (messages) => {
      broadcast('messages:changed', messages);
      persistMessages(messages);
    },
    storedMessages,
    (sender) => {
      const config = getConfiguration();
      const paths = config.messagePaths as Record<string, unknown> | undefined;
      const path = paths && typeof paths[sender] === 'string' ? paths[sender] as string : '';
      return {
        path,
        version: app.getVersion(),
        position: () => encodeBeacon({ ...validateStationConfiguration(config.station), beaconPath: path }),
      };
    },
    getMessageGroups,
    (id) => aprsIsRxService.isConfigured(id),
  );
  if (storedMessages.some((message) => message.status === 'pending'))
    persistMessages(messageService.snapshot());
  const storedInterfaces = getConfiguration().interfaces;
  if (Array.isArray(storedInterfaces)) {
    try {
      configureKiss(validateInterfaces(storedInterfaces));
    } catch {
      // Invalid saved interface configuration must not prevent the app from opening.
    }
  }
  ipcMain.handle('config:get-active-path', () => configStorage.getLocation());
  ipcMain.handle('config:get', () => getConfiguration());
  let tocallUpdate: Promise<{ count: number; generationTime?: string }> | undefined;
  ipcMain.handle('tocall:update', () => {
    if (!tocallUpdate) {
      tocallUpdate = updateTocalls((url, options) => net.fetch(url, options), tocallPath).then((result) => {
        stationStore.refreshDeviceIdentification();
        return result;
      }).finally(() => { tocallUpdate = undefined; });
    }
    return tocallUpdate;
  });
  let configWrites = Promise.resolve();
  const queueConfiguration = <T>(operation: () => Promise<T>): Promise<T> => {
    const write = configWrites.then(operation);
    configWrites = write.then(() => undefined, () => undefined);
    return write;
  };
  const assertProfile = (id: unknown) => {
    if (typeof id !== 'string' || id !== storedConfiguration().activeProfileId)
      throw new Error('The active profile changed. Reload its settings and try again.');
  };
  const commitConfiguration = async (next: ProfileConfiguration, resetStation: boolean, applyRuntime = false) => {
    const nextInterfaces = applyRuntime || resetStation ? validateInterfaces(runtimeConfiguration(next).interfaces) : undefined;
    if (nextInterfaces) {
      const profile = activeStationProfile(next);
      for (const item of nextInterfaces.filter((entry) => entry.type === 'aprs-is')) {
        const filter = item.aprsIsFilter ?? defaultAprsIsFilter(profile.station.location, item.aprsIsRadius || '25') ?? '';
        if (!validAprsIsFilter(appendAprsIsGroups(filter, profile.messageGroups.aprsIs))) throw new Error('APRS-IS filters and groups are too long.');
      }
    }
    if (resetStation) {
      switchingProfile = true;
      transmissionGeneration++;
      clearTimeout(beaconTimer);
      statusScheduler?.dispose();
      messageService.cancelPending();
    }
    try {
      if (resetStation && transmissions.size) {
        // Finish writes already handed to the transports before changing identity.
        // A stalled transport keeps the old profile active rather than mixing TX.
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled([...transmissions]),
            new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Transmission is still in progress. Wait for the interface, then switch again.')), 65_000); }),
          ]);
        } finally { clearTimeout(timeout); }
      }
      const location = await configStorage.save(next);
      if (nextInterfaces) configureKiss(nextInterfaces);
      if (applyRuntime || resetStation) {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send('config:runtime-changed', getConfiguration());
        }
      }
      return location;
    } finally {
      if (resetStation) switchingProfile = false;
      if (resetStation || applyRuntime) { scheduleBeacon(); statusScheduler?.schedule(); }
    }
  };
  const updateConfig = (patch: Record<string, unknown> | (() => Record<string, unknown>), profileId?: unknown) =>
    queueConfiguration(async () => {
      if (profileId !== undefined) assertProfile(profileId);
      const changes = typeof patch === 'function' ? patch() : patch;
      const current = storedConfiguration();
      const next = patchProfileConfiguration(current, changes);
      const before = activeStationProfile(current).station;
      const after = activeStationProfile(next).station;
      return commitConfiguration(next, before.callsign !== after.callsign || before.ssid !== after.ssid,
        ['station', 'interfaces', 'messageGroups', 'enabledInterfaceIds'].some((key) => key in changes));
    });
  ipcMain.handle('ble:auto-scan', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) throw new Error('Invalid window.');
    return event.sender.executeJavaScript('window.dispatchEvent(new Event("aprsbox:ble-auto-scan"))', true);
  });
  ipcMain.handle('ble:remember', (event, id: unknown, deviceId: unknown, deviceName: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string' || typeof deviceId !== 'string' || !deviceId || deviceId.length > 255 || typeof deviceName !== 'string' || deviceName.length > 255) throw new Error('Invalid Bluetooth device.');
    return updateConfig(() => {
      const items = validateInterfaces(getConfiguration().interfaces ?? []);
      const item = items.find((entry) => entry.id === id && entry.type === 'kiss-ble' && entry.enabled);
      if (!item || kissBleRxService.getStatuses()[id] !== 'connected') throw new Error('Bluetooth interface is not connected.');
      item.bleDeviceId = deviceId; item.bleDeviceName = deviceName;
      return { interfaces: items };
    });
  });
  const sendBeacon = async (station: StationConfiguration) => {
    const interfaces = validateInterfaces(
      getConfiguration().interfaces ?? [],
    );
    const statuses = kissStatuses();
    const targets = selectBeaconInterfaces(interfaces, station.beaconInterfaceId, (item) =>
      statuses[item.id] === 'connected' && (item.type !== 'aprs-is' || aprsIsRxService.canTransmit(item.id)),
    );
    const frame = encodeBeacon(station);
    const result = await transmitBeacon(targets, frame, transmitKiss);
    const packet = new KissFrameDecoder().consume(frame)[0];
    if (packet) {
      const source = result.sent[0];
      stationStore.receive(packet, source.name || source.hostPort || source.serialDevice);
    }
    if (result.failed.length) console.warn('Beacon not sent on some interfaces:', result.failed.map(({ interface: item, error }) => `${item.name || item.id}: ${error}`).join('; '));
    return { sent: result.sent.map((item) => item.name || item.id), failed: result.failed.map(({ interface: item, error }) => `${item.name || item.id}: ${error}`) };
  };
  const sendStatus = async (station: StationConfiguration) => {
    const statuses = kissStatuses();
    const targets = selectBeaconInterfaces(validateInterfaces(getConfiguration().interfaces ?? []), station.beaconInterfaceId, (item) =>
      statuses[item.id] === 'connected' && (item.type !== 'aprs-is' || aprsIsRxService.canTransmit(item.id)),
    );
    const frame = encodeStatus(station);
    const result = await transmitBeacon(targets, frame, transmitKiss);
    const packet = new KissFrameDecoder().consume(frame)[0];
    if (packet) {
      const source = result.sent[0];
      stationStore.receive(packet, source.name || source.hostPort || source.serialDevice || source.id, {
        source: source.type === 'aprs-is' ? 'aprs-is' : 'kiss', direction: 'tx',
      });
    }
    return { sent: result.sent.map((item) => item.name || item.id), failed: result.failed.map(({ interface: item, error }) => `${item.name || item.id}: ${error}`) };
  };
  statusScheduler = createStatusScheduler(
    () => {
      try { return validateStationConfiguration(getConfiguration().station); }
      catch { return { callsign: '', status: '', statusInterval: 'Never' }; }
    },
    async () => {
      const station = validateStationConfiguration(getConfiguration().station);
      const result = await sendStatus(station);
      if (result.failed.length) console.warn('Status not sent on some interfaces:', result.failed.join('; '));
    },
  );
  statusScheduler.schedule();
  const scheduleBeacon = (retry = false) => {
    clearTimeout(beaconTimer);
    const generation = ++transmissionGeneration;
    let station: StationConfiguration;
    try {
      station = validateStationConfiguration(getConfiguration().station);
      if (!station.callsign) return;
      const minutes = Number.parseInt(station.beaconInterval, 10);
      if (![15, 30, 60].includes(minutes)) return;
      beaconTimer = setTimeout(async () => {
        try {
          await sendBeacon(validateStationConfiguration(getConfiguration().station));
          if (generation === transmissionGeneration) scheduleBeacon();
        } catch (error) {
          console.error('Automatic beacon not sent:', error);
          if (generation === transmissionGeneration) scheduleBeacon(true);
        }
      }, retry ? 60_000 : minutes * 60_000);
      beaconTimer.unref();
    } catch {
      // An incomplete station configuration cannot be transmitted.
    }
  };
  scheduleBeacon();
  ipcMain.handle('config:save-station', (_event, station: unknown, profileId: unknown) => {
    assertProfile(profileId);
    return updateConfig({ station: validateStationConfiguration(station) }, profileId);
  });
  ipcMain.handle('config:profile-action', (_event, action: unknown, profileId: unknown, station: unknown) => {
    assertProfile(profileId);
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Invalid profile action.');
    const request = action as ProfileAction;
    const validatedStation = request.action === 'rename' || request.action === 'delete' ? undefined : validateStationConfiguration(station);
    return queueConfiguration(async () => {
      assertProfile(profileId);
      const current = storedConfiguration();
      const updated = validatedStation ? patchProfileConfiguration(current, { station: validatedStation }) : current;
      const next = applyProfileAction(updated, request);
      const before = activeStationProfile(current).station;
      const after = activeStationProfile(next).station;
      await commitConfiguration(next, current.activeProfileId !== next.activeProfileId || before.callsign !== after.callsign || before.ssid !== after.ssid, true);
      return getConfiguration();
    });
  });
  ipcMain.handle('config:save-map-mask', (_event, value: unknown) => {
    if (!value || typeof value !== 'object')
      throw new Error('Invalid map mask settings.');
    const { light, dark } = value as Record<string, unknown>;
    const valid = (number: unknown) =>
      typeof number === 'number' &&
      Number.isInteger(number) &&
      number >= 0 &&
      number <= 100 &&
      number % 10 === 0;
    if (!valid(light) || !valid(dark))
      throw new Error('Invalid map mask settings.');
    return updateConfig({ mapMaskOpacity: { light, dark } });
  });
  ipcMain.handle('config:save-scroller-visibility', (_event, visible: unknown) => {
    if (typeof visible !== 'boolean') throw new Error('Invalid scroller visibility.');
    return updateConfig({ scrollerVisible: visible });
  });
  ipcMain.handle('config:open-map-providers', () => shell.openExternal('https://switch2osm.org/providers/#Allows-free-usage'));
  ipcMain.handle('app:open-external', (_event, value: unknown) => {
    if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\/\S+$/i.test(value)) throw new Error('Invalid URL.');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Invalid URL.');
    return shell.openExternal(url.href);
  });
  ipcMain.handle('config:save-clock-mode', (_event, value: unknown) => {
    if (value !== 'utc' && value !== 'local') throw new Error('Invalid clock mode.');
    return updateConfig({ clockMode: value });
  });
  ipcMain.handle('config:save-map-settings', (_event, value: unknown) =>
    updateConfig({ mapSettings: validateMapSettings(value) }),
  );
  ipcMain.handle('map:cache-stats', (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length > 80) throw new Error('Invalid map source.');
    return tileCache.stats(id);
  });
  ipcMain.handle('map:clear-cache', (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length > 80) throw new Error('Invalid map source.');
    return tileCache.clear(id);
  });
  ipcMain.handle('config:save-map-viewport', (_event, value: unknown) => {
    if (!value || typeof value !== 'object')
      throw new Error('Invalid map viewport.');
    const { latitude, longitude, zoom } = value as Record<string, unknown>;
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      typeof zoom !== 'number' ||
      !Number.isInteger(zoom) ||
      zoom < 0 ||
      zoom > 19
    ) {
      throw new Error('Invalid map viewport.');
    }
    return updateConfig({ mapViewport: { latitude, longitude, zoom } });
  });
  const validateGroupFilters = (interfaces: InterfaceConfiguration[], groups: string[]) => {
    const station = getConfiguration().station as { location?: unknown } | undefined;
    for (const item of interfaces.filter((entry) => entry.type === 'aprs-is')) {
      const filter = item.aprsIsFilter ?? defaultAprsIsFilter(station?.location, item.aprsIsRadius || '25') ?? '';
      if (!validAprsIsFilter(appendAprsIsGroups(filter, groups))) throw new Error('APRS-IS filters and groups are too long.');
    }
  };
  ipcMain.handle('config:save-interfaces', (_event, interfaces: unknown, profileId: unknown) => {
    assertProfile(profileId);
    const validatedInterfaces = validateInterfaces(interfaces);
    return updateConfig(() => {
      validateGroupFilters(validatedInterfaces, getMessageGroups().aprsIs);
      return { interfaces: validatedInterfaces };
    }, profileId);
  });
  ipcMain.handle('config:save-message-groups', (_event, value: unknown, profileId: unknown) => {
    assertProfile(profileId);
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('rf' in value) || !('aprsIs' in value)) throw new Error('Invalid message group settings.');
    const groups = readMessageGroups(value);
    return updateConfig(() => {
      validateGroupFilters(validateInterfaces(getConfiguration().interfaces ?? []), groups.aprsIs);
      return { messageGroups: groups };
    }, profileId);
  });
  ipcMain.handle('config:save-message-interface', (_event, id: unknown, profileId: unknown) => {
    assertProfile(profileId);
    if (typeof id !== 'string' || id.length > 80) throw new Error('Invalid message interface.');
    return updateConfig(() => {
      if (id && !validateInterfaces(getConfiguration().interfaces ?? []).some((item) => item.id === id && item.enabled && !item.txBlocked)) throw new Error('Message interface is unavailable.');
      return { messageInterfaceId: id };
    }, profileId);
  });
  ipcMain.handle('config:save-message-path', (_event, recipient: unknown, path: unknown, profileId: unknown) => {
    assertProfile(profileId);
    if (typeof recipient !== 'string' || !/^(?:[A-Z0-9]{1,9}|[A-Z0-9]{1,6}-(?:[0-9]|1[0-5]))$/.test(recipient) || typeof path !== 'string' || path.length > 71) throw new Error('Invalid conversation path.');
    return updateConfig(() => {
      const stored = getConfiguration().messagePaths;
      const paths: Record<string, string> = {};
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [key, value] of Object.entries(stored)) {
          if (/^(?:[A-Z0-9]{1,9}|[A-Z0-9]{1,6}-(?:[0-9]|1[0-5]))$/.test(key) && typeof value === 'string' && value.length <= 71) paths[key] = value;
        }
      }
      if (path) {
        if (!Object.hasOwn(paths, recipient) && Object.keys(paths).length >= 1000) throw new Error('Too many saved conversation paths.');
        paths[recipient] = path;
      } else delete paths[recipient];
      return { messagePaths: paths };
    }, profileId);
  });
  ipcMain.handle('config:export-backup', async () => {
    const result = await dialog.showSaveDialog({ title: 'Export configuration backup', defaultPath: 'APRSBoxLite-config-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    if ([configStorage.getLocation().path, path.join(app.getPath('userData'), 'messages.json')].some((file) => path.resolve(file) === path.resolve(result.filePath!))) throw new Error('Choose a separate backup file.');
    await configWrites;
    await atomicWriteJson(result.filePath, createConfigurationBackup(storedConfiguration()));
    return true;
  });
  ipcMain.handle('config:import-backup', async () => {
    const result = await dialog.showOpenDialog({ title: 'Import configuration backup', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return false;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('Backup file is too large.');
    const configuration = readConfigurationBackup(JSON.parse(await fs.readFile(file, 'utf8')));
    const restored = normalizeProfileConfiguration(configuration);
    for (const profile of restored.profiles) {
      profile.station = { ...profile.station, ...validateStationConfiguration(profile.station) };
      validateInterfaces(runtimeConfiguration({ ...restored, activeProfileId: profile.id }).interfaces);
    }
    if (configuration.mapSettings !== undefined) restored.mapSettings = validateMapSettings(configuration.mapSettings);
    const confirmation = await dialog.showMessageBox({ type: 'warning', buttons: ['Cancel', 'Import'], defaultId: 0, cancelId: 0, title: 'Import configuration backup', message: 'Replace the current configuration with this backup?', detail: 'Saved station, interfaces and map settings will be replaced. Message history is not affected.' });
    if (confirmation.response !== 1) return false;
    await queueConfiguration(() => commitConfiguration(restored, true));
    return true;
  });
  ipcMain.handle('traffic:get-recent', () => kissHistory());
  ipcMain.handle('traffic:save-log', async (_event, filter: unknown) => {
    if (typeof filter !== 'string' || filter.length > 1024) throw new Error('Invalid traffic filter.');
    const snapshot = filterTrafficFrames(kissHistory(), filter);
    const station = getConfiguration().station as { callsign?: unknown; ssid?: unknown } | undefined;
    const callsign = typeof station?.callsign === 'string' ? station.callsign : '';
    const ssid = callsign.trim() && typeof station?.ssid === 'string' ? station.ssid : '';
    const result = await dialog.showSaveDialog({ title: 'Save traffic log', defaultPath: trafficLogFilename(`${callsign}${ssid}`, new Date()), filters: [{ name: 'Text files', extensions: ['txt'] }] });
    if (result.canceled || !result.filePath) return false;
    const canonical = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
    if ([configStorage.getLocation().path, path.join(app.getPath('userData'), 'messages.json')].some((file) => canonical(file) === canonical(result.filePath!))) throw new Error('Choose a separate log file.');
    await fs.writeFile(result.filePath, formatTrafficLog(snapshot), 'utf8');
    return true;
  });
  ipcMain.handle('stations:get', () => stationStore.snapshot());
  ipcMain.handle('messages:get', () => messageService.snapshot());
  ipcMain.handle('station:send-beacon', async (_event, value: unknown, profileId: unknown) => {
    assertProfile(profileId);
    if (switchingProfile) throw new Error('Station profile is changing.');
    const station = validateStationConfiguration(value);
    const result = await sendBeacon(station);
    scheduleBeacon();
    return result;
  });
  ipcMain.handle('station:send-status', async (_event, value: unknown, profileId: unknown) => {
    assertProfile(profileId);
    if (switchingProfile) throw new Error('Station profile is changing.');
    const result = await sendStatus(validateStationConfiguration(value));
    statusScheduler?.schedule();
    return result;
  });
  ipcMain.handle('messages:send', (_event, value: unknown, profileId: unknown) => {
    assertProfile(profileId);
    if (switchingProfile) throw new Error('Station profile is changing.');
    if (!value || typeof value !== 'object')
      throw new Error('Invalid message.');
    const { recipient, text, interfaceId, path } = value as Record<
      string,
      unknown
    >;
    if (
      typeof recipient !== 'string' ||
      typeof text !== 'string' ||
      typeof interfaceId !== 'string' ||
      typeof path !== 'string'
    )
      throw new Error('Invalid message.');
    if (!interfaceId && !getAvailableMessageInterfaces().length) throw new Error('No connected transmit interface is available for the message.');
    return messageService.send(recipient, text, interfaceId, path);
  });
  ipcMain.handle('messages:mark-read', (_event, recipient: unknown) => {
    if (typeof recipient !== 'string') throw new Error('Invalid conversation.');
    messageService.markConversationRead(recipient);
  });
  ipcMain.handle('messages:delete-conversation', (_event, recipient: unknown) => {
    if (typeof recipient !== 'string') throw new Error('Invalid conversation.');
    messageService.deleteConversation(recipient);
  });
  ipcMain.handle('messages:retry', (_event, id: unknown, profileId: unknown) => {
    assertProfile(profileId);
    if (switchingProfile) throw new Error('Station profile is changing.');
    if (typeof id !== 'string') throw new Error('Invalid message ID.');
    return messageService.retry(id);
  });
  ipcMain.handle('traffic:get-interface-statuses', () =>
    kissStatuses(),
  );
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let quitReady = false;
let quitting = false;
app.on('before-quit', (event) => {
  if (quitReady) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  clearTimeout(beaconTimer);
  statusScheduler?.dispose();
  kissTcpRxService?.stop();
  kissSerialRxService?.stop();
  aprsIsRxService?.stop();
  stationStore.dispose();
  messageService?.dispose();
  void (messageStorage?.flush() ?? Promise.resolve()).catch((error) => {
    console.error('Failed to finish saving message history:', error);
  }).finally(() => {
    quitReady = true;
    app.quit();
  });
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

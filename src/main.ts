import { app, BrowserWindow, dialog, ipcMain, net, powerMonitor, protocol, session } from 'electron';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { StationStore } from './main/stationStore';
import { MessageService } from './main/aprsMessages';
import { MessageStorage } from './main/messageStorage';
import { encodeBeacon } from './main/aprsBeacon';
import { classifyTraffic } from './main/trafficColors';
import type { Station, AprsMessage } from './types';
import { ConfigStorage, getApplicationDirectory, atomicWriteJson } from './main/configStorage';
import { DEFAULT_MAP_SETTINGS, validateMapSettings } from './mapSettings';
import { MapTileCache } from './main/mapTileCache';
import { createConfigurationBackup, readConfigurationBackup } from './main/configBackup';
import { filterTrafficFrames, formatTrafficLog, trafficLogFilename } from './trafficLog';
import { KissSerialRxService } from './main/kissSerialRx';
import { KissBleRxService } from './main/kissBleRx';
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
  type: 'kiss-tcp' | 'kiss-serial' | 'kiss-ble';
  enabled: boolean;
  txBlocked: boolean;
  hostPort: string;
  serialDevice: string;
  baudRate: string;
  reconnectTimeout: string;
  bleProfile?: 'rt-950-pro';
  bleDeviceId?: string;
  bleDeviceName?: string;
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
let kissTcpRxService: KissTcpRxService;
let kissSerialRxService: KissSerialRxService;
let messageService: MessageService;
let messageStorage: MessageStorage | undefined;
let beaconTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (type !== 'kiss-tcp' && type !== 'kiss-serial' && type !== 'kiss-ble') {
      throw new Error('Unsupported interface type.');
    }
    if (
      typeof source.enabled !== 'boolean' ||
      typeof source.txBlocked !== 'boolean'
    ) {
      throw new Error('Invalid interface state.');
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
  const tileCache = new MapTileCache(
    () => path.dirname(configStorage.getLocation().path),
    () => {
      try { return validateMapSettings(configStorage.getConfiguration().mapSettings ?? DEFAULT_MAP_SETTINGS).sources; }
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
      const station = configStorage.getConfiguration().station as { callsign?: unknown; ssid?: unknown } | undefined;
      if (typeof station?.callsign === 'string' && typeof station.ssid === 'string')
        frame.category = classifyTraffic(frame.packet, `${station.callsign}${station.ssid}`);
      broadcast('traffic:received', frame);
      if (frame.direction === 'rx') {
        stationStore.receive(frame.packet, frame.interfaceName);
        messageService.receive(frame.packet, frame.interfaceId);
      }
    };
  const onKissStatus = (interfaceId: string, status: ConnectionStatus) =>
    broadcast('traffic:interface-status', { interfaceId, status });
  kissTcpRxService = new KissTcpRxService(onKissFrame, onKissStatus);
  kissSerialRxService = new KissSerialRxService(onKissFrame, onKissStatus);
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
  const configureKiss = (interfaces: InterfaceConfiguration[]) => {
    const wired = interfaces.filter((item): item is InterfaceConfiguration & { type: 'kiss-tcp' | 'kiss-serial' } => item.type !== 'kiss-ble');
    kissTcpRxService.configure(wired);
    kissSerialRxService.configure(wired);
    kissBleRxService.configure(interfaces);
  };
  ipcMain.on('ble:status', (event, id: unknown, status: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string' || !['connecting', 'connected', 'disconnected', 'error'].includes(String(status))) return;
    kissBleRxService.status(id, status as ConnectionStatus);
  });
  ipcMain.on('ble:receive', (event, id: unknown, bytes: unknown) => {
    if (BrowserWindow.fromWebContents(event.sender) && typeof id === 'string' && bytes instanceof Uint8Array) kissBleRxService.receive(id, bytes);
  });
  const transmitKiss = (interfaceId: string, frame: Uint8Array) =>
    kissBleRxService.isConfigured(interfaceId)
      ? kissBleRxService.transmit(interfaceId, frame)
      : kissSerialRxService.isConfigured(interfaceId)
      ? kissSerialRxService.transmit(interfaceId, frame)
      : kissTcpRxService.transmit(interfaceId, frame);
  const kissStatuses = () => ({ ...kissTcpRxService.getStatuses(), ...kissSerialRxService.getStatuses(), ...kissBleRxService.getStatuses() });
  const kissHistory = () => [...kissTcpRxService.getHistory(), ...kissSerialRxService.getHistory(), ...kissBleRxService.getHistory()]
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
    notifyPower('system:resume');
  });
  messageService = new MessageService(
    () => {
      const station = configStorage.getConfiguration().station as
        | { callsign?: unknown; ssid?: unknown }
        | undefined;
      if (
        typeof station?.callsign !== 'string' ||
        typeof station.ssid !== 'string'
      )
        throw new Error('Configure and save My Station first.');
      return `${station.callsign}${station.ssid}`;
    },
    transmitKiss,
    (messages) => {
      broadcast('messages:changed', messages);
      persistMessages(messages);
    },
    storedMessages,
  );
  if (storedMessages.some((message) => message.status === 'pending'))
    persistMessages(messageService.snapshot());
  const storedInterfaces = configStorage.getConfiguration().interfaces;
  if (Array.isArray(storedInterfaces)) {
    try {
      configureKiss(validateInterfaces(storedInterfaces));
    } catch {
      // Invalid saved interface configuration must not prevent the app from opening.
    }
  }
  ipcMain.handle('config:get-active-path', () => configStorage.getLocation());
  ipcMain.handle('config:get', () => configStorage.getConfiguration());
  let configWrites = Promise.resolve();
  const updateConfig = (patch: Record<string, unknown>) => {
    const write = configWrites.then(() =>
      configStorage.save({ ...configStorage.getConfiguration(), ...patch }),
    );
    configWrites = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  };
  ipcMain.handle('ble:auto-scan', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) throw new Error('Invalid window.');
    return event.sender.executeJavaScript('window.dispatchEvent(new Event("aprsbox:ble-auto-scan"))', true);
  });
  ipcMain.handle('ble:remember', (event, id: unknown, deviceId: unknown, deviceName: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof id !== 'string' || typeof deviceId !== 'string' || !deviceId || deviceId.length > 255 || typeof deviceName !== 'string' || deviceName.length > 255) throw new Error('Invalid Bluetooth device.');
    const write = configWrites.then(async () => {
      const items = validateInterfaces(configStorage.getConfiguration().interfaces ?? []);
      const item = items.find((entry) => entry.id === id && entry.type === 'kiss-ble' && entry.enabled);
      if (!item || kissBleRxService.getStatuses()[id] !== 'connected') throw new Error('Bluetooth interface is not connected.');
      item.bleDeviceId = deviceId; item.bleDeviceName = deviceName;
      await configStorage.save({ ...configStorage.getConfiguration(), interfaces: items });
      configureKiss(items);
    });
    configWrites = write.then(() => undefined, () => undefined);
    return write;
  });
  const sendBeacon = async (station: StationConfiguration) => {
    const interfaces = validateInterfaces(
      configStorage.getConfiguration().interfaces ?? [],
    );
    const statuses = kissStatuses();
    const eligible = interfaces.filter(
      (item) => item.enabled && !item.txBlocked,
    );
    const connected = eligible.filter((item) => statuses[item.id] === 'connected');
    const interfaceId = station.beaconInterfaceId ||
      (connected.length === 1 ? connected[0].id : '');
    if (!interfaceId) throw new Error('Choose a connected transmit interface.');
    const selected = interfaces.find((item) => item.id === interfaceId);
    if (!selected) throw new Error('The selected beacon interface no longer exists. Choose another interface in My Station.');
    if (!selected.enabled) throw new Error(`Beacon interface "${selected.name || interfaceId}" is disabled. Choose an enabled interface in My Station.`);
    if (selected.txBlocked) throw new Error(`TX is blocked on beacon interface "${selected.name || interfaceId}". Unblock TX in Interfaces or choose another interface in My Station.`);
    if (statuses[interfaceId] !== 'connected') throw new Error(`Beacon interface "${selected.name || interfaceId}" is not connected.`);
    const frame = encodeBeacon(station);
    await transmitKiss(interfaceId, frame);
    const packet = new KissFrameDecoder().consume(frame)[0];
    if (packet) {
      const source = eligible.find((item) => item.id === interfaceId);
      stationStore.receive(packet, source?.name || source?.hostPort || source?.serialDevice);
    }
  };
  const scheduleBeacon = (retry = false) => {
    clearTimeout(beaconTimer);
    let station: StationConfiguration;
    try {
      station = validateStationConfiguration(configStorage.getConfiguration().station);
      if (!station.callsign) return;
      const minutes = Number.parseInt(station.beaconInterval, 10);
      if (![15, 30, 60].includes(minutes)) return;
      beaconTimer = setTimeout(async () => {
        try {
          await sendBeacon(validateStationConfiguration(configStorage.getConfiguration().station));
          scheduleBeacon();
        } catch (error) {
          console.error('Automatic beacon not sent:', error);
          scheduleBeacon(true);
        }
      }, retry ? 60_000 : minutes * 60_000);
      beaconTimer.unref();
    } catch {
      // An incomplete station configuration cannot be transmitted.
    }
  };
  scheduleBeacon();
  ipcMain.handle('config:save-station', (_event, station: unknown) =>
    updateConfig({ station: validateStationConfiguration(station) }).then((location) => {
      scheduleBeacon();
      return location;
    }),
  );
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
  ipcMain.handle('config:save-interfaces', (_event, interfaces: unknown) => {
    const validatedInterfaces = validateInterfaces(interfaces);
    return updateConfig({ interfaces: validatedInterfaces }).then(
      (location) => {
        configureKiss(validatedInterfaces);
        return location;
      },
    );
  });
  ipcMain.handle('config:export-backup', async () => {
    const result = await dialog.showSaveDialog({ title: 'Export configuration backup', defaultPath: 'APRSBoxLite-config-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    if ([configStorage.getLocation().path, path.join(app.getPath('userData'), 'messages.json')].some((file) => path.resolve(file) === path.resolve(result.filePath!))) throw new Error('Choose a separate backup file.');
    await configWrites;
    await atomicWriteJson(result.filePath, createConfigurationBackup(configStorage.getConfiguration()));
    return true;
  });
  ipcMain.handle('config:import-backup', async () => {
    const result = await dialog.showOpenDialog({ title: 'Import configuration backup', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return false;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('Backup file is too large.');
    const configuration = readConfigurationBackup(JSON.parse(await fs.readFile(file, 'utf8')));
    const restored = { ...configuration };
    if (configuration.station !== undefined) restored.station = validateStationConfiguration(configuration.station);
    const interfaces = configuration.interfaces === undefined ? [] : validateInterfaces(configuration.interfaces);
    if (configuration.interfaces !== undefined) restored.interfaces = interfaces;
    if (configuration.mapSettings !== undefined) restored.mapSettings = validateMapSettings(configuration.mapSettings);
    const confirmation = await dialog.showMessageBox({ type: 'warning', buttons: ['Cancel', 'Import'], defaultId: 0, cancelId: 0, title: 'Import configuration backup', message: 'Replace the current configuration with this backup?', detail: 'Saved station, interfaces and map settings will be replaced. Message history is not affected.' });
    if (confirmation.response !== 1) return false;
    const write = configWrites.then(() => configStorage.save(restored));
    configWrites = write.then(() => undefined, () => undefined);
    await write;
    configureKiss(interfaces);
    scheduleBeacon();
    return true;
  });
  ipcMain.handle('traffic:get-recent', () => kissHistory());
  ipcMain.handle('traffic:save-log', async (_event, filter: unknown) => {
    if (typeof filter !== 'string' || filter.length > 1024) throw new Error('Invalid traffic filter.');
    const snapshot = filterTrafficFrames(kissHistory(), filter);
    const station = configStorage.getConfiguration().station as { callsign?: unknown; ssid?: unknown } | undefined;
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
  ipcMain.handle('station:send-beacon', async (_event, value: unknown) => {
    const station = validateStationConfiguration(value);
    await sendBeacon(station);
    scheduleBeacon();
  });
  ipcMain.handle('messages:send', (_event, value: unknown) => {
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
    return messageService.send(recipient, text, interfaceId, path);
  });
  ipcMain.handle('messages:retry', (_event, id: unknown) => {
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
  kissTcpRxService?.stop();
  kissSerialRxService?.stop();
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

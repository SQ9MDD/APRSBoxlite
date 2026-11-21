import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { StationStore } from './main/stationStore';
import { MessageService } from './main/aprsMessages';
import { encodeBeacon } from './main/aprsBeacon';
import type { Station, AprsMessage } from './types';
import { ConfigStorage, getApplicationDirectory } from './main/configStorage';
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
  type: 'kiss-tcp' | 'kiss-serial';
  enabled: boolean;
  txBlocked: boolean;
  hostPort: string;
  serialDevice: string;
  baudRate: string;
  reconnectTimeout: string;
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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
let messageService: MessageService;
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
    if (type !== 'kiss-tcp' && type !== 'kiss-serial') {
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
    };
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
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
  kissTcpRxService = new KissTcpRxService(
    (frame) => {
      broadcast('traffic:received', frame);
      stationStore.receive(frame.packet, frame.interfaceName);
      messageService.receive(frame.packet, frame.interfaceId);
    },
    (interfaceId, status) =>
      broadcast('traffic:interface-status', { interfaceId, status }),
  );
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
    (interfaceId, frame) => kissTcpRxService.transmit(interfaceId, frame),
    (messages) => broadcast('messages:changed', messages),
  );
  const storedInterfaces = configStorage.getConfiguration().interfaces;
  if (Array.isArray(storedInterfaces)) {
    try {
      kissTcpRxService.configure(validateInterfaces(storedInterfaces));
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
  const sendBeacon = async (station: StationConfiguration) => {
    const interfaces = validateInterfaces(
      configStorage.getConfiguration().interfaces ?? [],
    );
    const statuses = kissTcpRxService.getStatuses();
    const eligible = interfaces.filter(
      (item) => item.type === 'kiss-tcp' && item.enabled && !item.txBlocked,
    );
    const connected = eligible.filter((item) => statuses[item.id] === 'connected');
    const interfaceId = station.beaconInterfaceId ||
      (connected.length === 1 ? connected[0].id : '');
    if (!interfaceId) throw new Error('Choose a connected transmit interface.');
    const frame = encodeBeacon(station);
    await kissTcpRxService.transmit(interfaceId, frame);
    const packet = new KissFrameDecoder().consume(frame)[0];
    if (packet) {
      const source = eligible.find((item) => item.id === interfaceId);
      stationStore.receive(packet, source?.name || source?.hostPort);
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
        kissTcpRxService.configure(validatedInterfaces);
        return location;
      },
    );
  });
  ipcMain.handle('traffic:get-recent', () => kissTcpRxService.getHistory());
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
    kissTcpRxService.getStatuses(),
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

app.on('before-quit', () => {
  clearTimeout(beaconTimer);
  kissTcpRxService?.stop();
  stationStore.dispose();
  messageService?.dispose();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

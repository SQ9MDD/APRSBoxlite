import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { ConfigStorage, getApplicationDirectory } from './main/configStorage';
import {
  KissTcpRxService,
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

function broadcast(
  channel: string,
  payload:
    | TrafficFrame
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
  return {
    callsign: getText('callsign', 9).toUpperCase(),
    ssid,
    location: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    comment: getText('comment', 36),
    status: getText('status', 62),
    beaconInterval: getText('beaconInterval', 32),
    statusInterval: getText('statusInterval', 32),
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
    (frame) => broadcast('traffic:received', frame),
    (interfaceId, status) =>
      broadcast('traffic:interface-status', { interfaceId, status }),
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
  ipcMain.handle('config:save-station', (_event, station: unknown) => {
    const nextConfiguration = {
      ...configStorage.getConfiguration(),
      station: validateStationConfiguration(station),
    };
    return configStorage.save(nextConfiguration);
  });
  ipcMain.handle('config:save-interfaces', (_event, interfaces: unknown) => {
    const validatedInterfaces = validateInterfaces(interfaces);
    const nextConfiguration = {
      ...configStorage.getConfiguration(),
      interfaces: validatedInterfaces,
    };
    return configStorage.save(nextConfiguration).then((location) => {
      kissTcpRxService.configure(validatedInterfaces);
      return location;
    });
  });
  ipcMain.handle('traffic:get-recent', () => kissTcpRxService.getHistory());
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
  kissTcpRxService?.stop();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

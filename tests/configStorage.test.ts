import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ConfigStorage,
  getApplicationDirectory,
} from '../src/main/configStorage.ts';

async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'aprsbox-lite-config-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('uses and preserves an existing portable configuration', async () => {
  await withTemporaryDirectory(async (directory) => {
    const applicationDirectory = path.join(directory, 'portable');
    const userDataDirectory = path.join(directory, 'user-data');
    const portablePath = path.join(applicationDirectory, 'config.json');
    await mkdir(applicationDirectory, { recursive: true });
    await writeFile(
      portablePath,
      JSON.stringify({ station: { callsign: 'SQ9MDD' }, retained: true }),
      'utf8',
    );

    const storage = new ConfigStorage({
      applicationDirectory,
      userDataDirectory,
    });
    const location = await storage.initialize();

    assert.deepEqual(location, { path: portablePath, storage: 'portable' });
    assert.deepEqual(storage.getConfiguration(), {
      station: { callsign: 'SQ9MDD' },
      retained: true,
    });

    await storage.save({ station: { callsign: 'SQ9MDD-8' }, retained: true });
    assert.deepEqual(JSON.parse(await readFile(portablePath, 'utf8')), {
      station: { callsign: 'SQ9MDD-8' },
      retained: true,
    });
  });
});

test('falls back to userData when a portable config cannot be created', async () => {
  await withTemporaryDirectory(async (directory) => {
    const blockedApplicationPath = path.join(directory, 'not-a-directory');
    const userDataDirectory = path.join(directory, 'user-data');
    await writeFile(blockedApplicationPath, 'not a directory', 'utf8');

    const storage = new ConfigStorage({
      applicationDirectory: blockedApplicationPath,
      userDataDirectory,
    });
    const location = await storage.initialize();
    const fallbackPath = path.join(userDataDirectory, 'config.json');

    assert.deepEqual(location, { path: fallbackPath, storage: 'userData' });
    assert.deepEqual(JSON.parse(await readFile(fallbackPath, 'utf8')), {});
  });
});

test('prefers an existing userData config before creating a portable config', async () => {
  await withTemporaryDirectory(async (directory) => {
    const applicationDirectory = path.join(directory, 'portable');
    const userDataDirectory = path.join(directory, 'user-data');
    const fallbackPath = path.join(userDataDirectory, 'config.json');
    await mkdir(userDataDirectory, { recursive: true });
    await writeFile(
      fallbackPath,
      JSON.stringify({ retained: 'fallback' }),
      'utf8',
    );

    const storage = new ConfigStorage({
      applicationDirectory,
      userDataDirectory,
    });
    const location = await storage.initialize();

    assert.deepEqual(location, { path: fallbackPath, storage: 'userData' });
    assert.deepEqual(storage.getConfiguration(), { retained: 'fallback' });
  });
});

test('persists configured interfaces without replacing station settings', async () => {
  await withTemporaryDirectory(async (directory) => {
    const applicationDirectory = path.join(directory, 'portable');
    const userDataDirectory = path.join(directory, 'user-data');
    const storage = new ConfigStorage({
      applicationDirectory,
      userDataDirectory,
    });
    await storage.initialize();

    await storage.save({
      station: { callsign: 'SQ9MDD', ssid: '-15' },
      interfaces: [
        {
          id: 'tcp-1',
          name: 'Home TNC',
          type: 'kiss-tcp',
          enabled: true,
          txBlocked: false,
          hostPort: '127.0.0.1:8001',
          serialDevice: '',
          baudRate: '9600',
          reconnectTimeout: '150',
        },
      ],
    });

    assert.deepEqual(storage.getConfiguration(), {
      station: { callsign: 'SQ9MDD', ssid: '-15' },
      interfaces: [
        {
          id: 'tcp-1',
          name: 'Home TNC',
          type: 'kiss-tcp',
          enabled: true,
          txBlocked: false,
          hostPort: '127.0.0.1:8001',
          serialDevice: '',
          baudRate: '9600',
          reconnectTimeout: '150',
        },
      ],
    });
  });
});

test('uses the Windows portable launcher directory instead of its extraction directory', () => {
  assert.equal(
    getApplicationDirectory({
      appPath:
        'C:\\Users\\operator\\AppData\\Local\\Temp\\portable\\resources\\app.asar',
      executablePath:
        'C:\\Users\\operator\\AppData\\Local\\Temp\\portable\\aprsbox-lite.exe',
      portableExecutableDirectory: 'D:\\Radio Apps\\APRSBox Lite',
      isPackaged: true,
      platform: 'win32',
    }),
    'D:\\Radio Apps\\APRSBox Lite',
  );
});

test('uses the Windows application directory when the portable launcher directory is empty', () => {
  assert.equal(
    getApplicationDirectory({
      appPath: 'C:\\APRSBox Lite\\resources\\app.asar',
      executablePath: 'C:\\APRSBox Lite\\aprsbox-lite.exe',
      portableExecutableDirectory: '',
      isPackaged: true,
      platform: 'win32',
    }),
    'C:\\APRSBox Lite',
  );
});

test('ignores the portable launcher directory during Windows development', () => {
  assert.equal(
    getApplicationDirectory({
      appPath: 'C:\\work\\aprsbox-lite',
      executablePath:
        'C:\\work\\aprsbox-lite\\node_modules\\electron\\dist\\electron.exe',
      portableExecutableDirectory: 'D:\\Radio Apps\\APRSBox Lite',
      isPackaged: false,
      platform: 'win32',
    }),
    'C:\\work\\aprsbox-lite',
  );
});

test('resolves platform application directories', () => {
  assert.equal(
    getApplicationDirectory({
      appPath: '/work/aprsbox-lite',
      executablePath: '/opt/Electron/electron',
      isPackaged: false,
      platform: 'darwin',
    }),
    '/work/aprsbox-lite',
  );
  assert.equal(
    getApplicationDirectory({
      appPath: 'C:\\Program Files\\APRSBox Lite\\resources\\app.asar',
      executablePath: 'C:\\Program Files\\APRSBox Lite\\APRSBox Lite.exe',
      isPackaged: true,
      platform: 'win32',
    }),
    'C:\\Program Files\\APRSBox Lite',
  );
  assert.equal(
    getApplicationDirectory({
      appPath: '/Applications/APRSBox Lite.app/Contents/Resources/app.asar',
      executablePath:
        '/Applications/APRSBox Lite.app/Contents/MacOS/APRSBox Lite',
      portableExecutableDirectory: 'D:\\Radio Apps\\APRSBox Lite',
      isPackaged: true,
      platform: 'darwin',
    }),
    '/Applications',
  );
  assert.equal(
    getApplicationDirectory({
      appPath: '/tmp/.mount_app/resources/app.asar',
      executablePath: '/tmp/.mount_app/aprsbox-lite',
      appImagePath: '/home/user/Downloads/APRSBoxLite.AppImage',
      portableExecutableDirectory: 'D:\\Radio Apps\\APRSBox Lite',
      isPackaged: true,
      platform: 'linux',
    }),
    '/home/user/Downloads',
  );
});

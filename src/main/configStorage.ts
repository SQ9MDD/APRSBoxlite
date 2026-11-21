import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

export type JsonObject = Record<string, unknown>;
export type StorageKind = 'portable' | 'userData';

export interface ConfigurationLocation {
  path: string;
  storage: StorageKind;
}

export interface ConfigStorageOptions {
  applicationDirectory: string;
  userDataDirectory: string;
}

export interface ApplicationDirectoryOptions {
  appPath: string;
  executablePath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appImagePath?: string;
}

export function getApplicationDirectory({
  appPath,
  executablePath,
  isPackaged,
  platform,
  appImagePath,
}: ApplicationDirectoryOptions): string {
  const platformPath = platform === 'win32' ? path.win32 : path;
  if (!isPackaged) return platformPath.resolve(appPath);
  if (platform === 'darwin')
    return getMacApplicationDirectory(appPath, executablePath);
  if (platform === 'linux' && appImagePath)
    return platformPath.dirname(appImagePath);
  return platformPath.dirname(executablePath);
}

function getMacApplicationDirectory(
  appPath: string,
  executablePath: string,
): string {
  for (const candidate of [appPath, executablePath]) {
    let current = path.resolve(candidate);
    while (current !== path.dirname(current)) {
      if (path.basename(current).endsWith('.app')) return path.dirname(current);
      current = path.dirname(current);
    }
  }
  return path.dirname(executablePath);
}

export class ConfigStorage {
  private activeLocation: ConfigurationLocation | undefined;
  private configuration: JsonObject = {};
  private readonly options: ConfigStorageOptions;

  constructor(options: ConfigStorageOptions) {
    this.options = options;
  }

  async initialize(): Promise<ConfigurationLocation> {
    if (this.activeLocation) return this.activeLocation;

    const portablePath = path.join(
      this.options.applicationDirectory,
      'config.json',
    );
    const fallbackPath = path.join(
      this.options.userDataDirectory,
      'config.json',
    );

    if (await fileExists(portablePath)) {
      const portableConfig = await readJson(portablePath);
      if (await isWritableFile(portablePath)) {
        return this.setActive(portablePath, 'portable', portableConfig);
      }
      return this.migrateToFallback(portableConfig, fallbackPath);
    }

    if (await fileExists(fallbackPath)) {
      const fallbackConfig = await readJson(fallbackPath);
      return this.setActive(fallbackPath, 'userData', fallbackConfig);
    }

    try {
      await atomicWriteJson(portablePath, {});
      return this.setActive(portablePath, 'portable', {});
    } catch {
      await atomicWriteJson(fallbackPath, {});
      return this.setActive(fallbackPath, 'userData', {});
    }
  }

  getLocation(): ConfigurationLocation {
    if (!this.activeLocation) {
      throw new Error('Configuration storage has not been initialized.');
    }
    return { ...this.activeLocation };
  }

  getConfiguration(): JsonObject {
    return structuredClone(this.configuration);
  }

  async save(nextConfiguration: JsonObject): Promise<ConfigurationLocation> {
    const location = this.getLocation();
    try {
      await atomicWriteJson(location.path, nextConfiguration);
      this.configuration = structuredClone(nextConfiguration);
      return location;
    } catch (error) {
      if (location.storage !== 'portable') throw error;
      const fallbackPath = path.join(
        this.options.userDataDirectory,
        'config.json',
      );
      return this.migrateToFallback(nextConfiguration, fallbackPath);
    }
  }

  private async migrateToFallback(
    portableConfig: JsonObject,
    fallbackPath: string,
  ): Promise<ConfigurationLocation> {
    const existingFallback = (await fileExists(fallbackPath))
      ? await readJson(fallbackPath)
      : {};
    const migratedConfig = mergeJson(existingFallback, portableConfig);
    await atomicWriteJson(fallbackPath, migratedConfig);
    return this.setActive(fallbackPath, 'userData', migratedConfig);
  }

  private setActive(
    filePath: string,
    storage: StorageKind,
    configuration: JsonObject,
  ): ConfigurationLocation {
    this.activeLocation = { path: filePath, storage };
    this.configuration = structuredClone(configuration);
    return this.getLocation();
  }
}

export async function atomicWriteJson(
  filePath: string,
  configuration: JsonObject,
): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(configuration, null, 2)}\n`,
      'utf8',
    );
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isWritableFile(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.W_OK);
    await fs.access(path.dirname(filePath), fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<JsonObject> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isJsonObject(parsed)) {
    throw new Error(`Configuration at ${filePath} must contain a JSON object.`);
  }
  return parsed;
}

function mergeJson(base: JsonObject, override: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] =
      isJsonObject(value) && isJsonObject(base[key])
        ? mergeJson(base[key], value)
        : value;
  }
  return merged;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

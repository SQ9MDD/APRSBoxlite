import { readMessageGroups, type MessageGroups } from './messageGroups';

export interface StationSettings {
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

export const DEFAULT_STATION: StationSettings = {
  callsign: '', ssid: '-0', location: '50.0619, 19.9383',
  comment: 'APRSBox Lite station', status: 'Monitoring APRS traffic',
  beaconInterval: 'Never', statusInterval: 'Never',
  symbolTable: '/', symbolCode: '>', symbolOverlay: '',
  beaconPath: '', beaconInterfaceId: '',
};

export interface StationProfile {
  id: string;
  name: string;
  station: StationSettings;
  enabledInterfaceIds: string[];
  txBlockedInterfaceIds: string[];
  rfToIsInterfaceIds: string[];
  messageInterfaceId: string;
  messagePaths: Record<string, string>;
  messageGroups: MessageGroups;
}

export function profileLabel(profile: StationProfile, index: number): string {
  return `PM${index + 1} (${profile.name})`;
}

type JsonObject = Record<string, unknown>;
export type ProfileConfiguration = JsonObject & {
  profiles: StationProfile[];
  activeProfileId: string;
  interfaces: JsonObject[];
};
export type ProfileAction = {
  action: 'select' | 'create' | 'duplicate' | 'rename' | 'delete';
  id?: string;
  name?: string;
};

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

export function createStationProfile(name: string): StationProfile {
  return {
    id: crypto.randomUUID(), name, station: { ...DEFAULT_STATION },
    enabledInterfaceIds: [], txBlockedInterfaceIds: [], rfToIsInterfaceIds: [],
    messageInterfaceId: '', messagePaths: {}, messageGroups: readMessageGroups(undefined),
  };
}

// Keep the persisted configuration canonical. Runtime/UI projections below are
// the only places where hardware and per-profile interface flags are combined.
export function normalizeProfileConfiguration(configuration: JsonObject): ProfileConfiguration {
  const result = structuredClone(configuration);
  const interfaces = Array.isArray(result.interfaces) ? result.interfaces.map(object) : [];
  const interfaceIds = new Set(interfaces.map((item) => item.id));
  const ids = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && interfaceIds.has(id)))] : [];
  const profiles = Array.isArray(result.profiles) ? result.profiles.map(object) : [];
  if (!profiles.length) {
    profiles.push({
      ...createStationProfile('Default'),
      station: { ...DEFAULT_STATION, ...object(result.station) },
      enabledInterfaceIds: interfaces.filter((item) => item.enabled === true).map((item) => item.id),
      txBlockedInterfaceIds: interfaces.filter((item) => item.txBlocked === true).map((item) => item.id),
      rfToIsInterfaceIds: interfaces.filter((item) => item.aprsIsIgateRfToIs === true).map((item) => item.id),
      messageInterfaceId: result.messageInterfaceId,
      messagePaths: result.messagePaths,
      messageGroups: result.messageGroups,
    });
  }
  const used = new Set<string>();
  const normalized = profiles.map((profile, index): StationProfile => {
    const id = typeof profile.id === 'string' && profile.id && !used.has(profile.id) ? profile.id : crypto.randomUUID();
    used.add(id);
    return {
      id,
      name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim().slice(0, 80) : `Profile ${index + 1}`,
      station: { ...DEFAULT_STATION, ...object(profile.station) } as StationSettings,
      enabledInterfaceIds: ids(profile.enabledInterfaceIds),
      txBlockedInterfaceIds: ids(profile.txBlockedInterfaceIds),
      rfToIsInterfaceIds: ids(profile.rfToIsInterfaceIds),
      // Keep a missing explicit TX target: it must fail safely, never fall back
      // to automatic transmission on every other interface.
      messageInterfaceId: typeof profile.messageInterfaceId === 'string' ? profile.messageInterfaceId : '',
      messagePaths: object(profile.messagePaths) as Record<string, string>,
      messageGroups: readMessageGroups(profile.messageGroups),
    };
  });
  for (const key of ['station', 'messageInterfaceId', 'messagePaths', 'messageGroups']) delete result[key];
  return {
    ...result,
    interfaces: interfaces.map(({ enabled: _enabled, txBlocked: _tx, aprsIsIgateRfToIs: _igate, ...hardware }) => hardware),
    profiles: normalized,
    activeProfileId: typeof result.activeProfileId === 'string' && used.has(result.activeProfileId) ? result.activeProfileId : normalized[0].id,
  };
}

export function activeStationProfile(configuration: ProfileConfiguration): StationProfile {
  return configuration.profiles.find((profile) => profile.id === configuration.activeProfileId)!;
}

export function runtimeConfiguration(configuration: ProfileConfiguration): JsonObject {
  const profile = activeStationProfile(configuration);
  return {
    ...configuration,
    station: profile.station,
    messageInterfaceId: profile.messageInterfaceId,
    messagePaths: profile.messagePaths,
    messageGroups: profile.messageGroups,
    interfaces: configuration.interfaces.map((item) => ({
      ...item,
      enabled: profile.enabledInterfaceIds.includes(String(item.id)),
      txBlocked: profile.txBlockedInterfaceIds.includes(String(item.id)),
      ...(item.type === 'aprs-is' ? { aprsIsIgateRfToIs: profile.rfToIsInterfaceIds.includes(String(item.id)) } : {}),
    })),
  };
}

export function patchProfileConfiguration(configuration: ProfileConfiguration, patch: JsonObject): ProfileConfiguration {
  const next = structuredClone(configuration);
  const profile = activeStationProfile(next);
  const global = { ...patch };
  if (patch.station !== undefined) profile.station = { ...profile.station, ...object(patch.station) };
  if (patch.messageInterfaceId !== undefined) profile.messageInterfaceId = patch.messageInterfaceId as string;
  if (patch.messagePaths !== undefined) profile.messagePaths = patch.messagePaths as Record<string, string>;
  if (patch.messageGroups !== undefined) profile.messageGroups = patch.messageGroups as MessageGroups;
  if (patch.enabledInterfaceIds !== undefined) profile.enabledInterfaceIds = patch.enabledInterfaceIds as string[];
  if (Array.isArray(patch.interfaces)) {
    const interfaces = patch.interfaces.map(object);
    profile.enabledInterfaceIds = interfaces.filter((item) => item.enabled === true).map((item) => String(item.id));
    profile.txBlockedInterfaceIds = interfaces.filter((item) => item.txBlocked === true).map((item) => String(item.id));
    profile.rfToIsInterfaceIds = interfaces.filter((item) => item.aprsIsIgateRfToIs === true).map((item) => String(item.id));
  }
  for (const key of ['station', 'messageInterfaceId', 'messagePaths', 'messageGroups', 'enabledInterfaceIds']) delete global[key];
  return normalizeProfileConfiguration({ ...next, ...global });
}

export function applyProfileAction(configuration: ProfileConfiguration, value: ProfileAction): ProfileConfiguration {
  const next = structuredClone(configuration);
  const selected = next.profiles.find((profile) => profile.id === value.id);
  if (value.action !== 'create' && !selected) throw new Error('Profile no longer exists.');
  if (['create', 'duplicate', 'rename'].includes(value.action)) {
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 80) throw new Error('Enter a profile name (1–80 characters).');
  }
  switch (value.action) {
    case 'create':
    case 'duplicate': {
      const profile = value.action === 'duplicate' ? { ...structuredClone(selected!), id: crypto.randomUUID(), name: value.name!.trim() } : createStationProfile(value.name!.trim());
      next.profiles.push(profile);
      next.activeProfileId = profile.id;
      break;
    }
    case 'select': next.activeProfileId = selected!.id; break;
    case 'rename': selected!.name = value.name!.trim(); break;
    case 'delete':
      if (next.profiles.length === 1) throw new Error('The last profile cannot be deleted.');
      next.profiles = next.profiles.filter((profile) => profile !== selected);
      if (next.activeProfileId === selected!.id) next.activeProfileId = next.profiles[0].id;
      break;
    default: throw new Error('Invalid profile action.');
  }
  return next;
}

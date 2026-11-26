import { contextBridge, ipcRenderer } from 'electron';
import type { Station, AprsMessage } from './types';

contextBridge.exposeInMainWorld('aprsbox', {
  ble: {
    begin: () => ipcRenderer.send('ble:begin'),
    autoScan: (): Promise<void> => ipcRenderer.invoke('ble:auto-scan'),
    remember: (id: string, deviceId: string, name: string): Promise<void> => ipcRenderer.invoke('ble:remember', id, deviceId, name),
    choose: (id: string) => ipcRenderer.send('ble:choose', id),
    status: (id: string, status: string) => ipcRenderer.send('ble:status', id, status),
    receive: (id: string, bytes: Uint8Array) => ipcRenderer.send('ble:receive', id, bytes),
    onWrite: (callback: (request: { requestId: string; interfaceId: string; bytes: Uint8Array }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: { requestId: string; interfaceId: string; bytes: Uint8Array }) => callback(request);
      ipcRenderer.on('ble:write', listener);
      return () => ipcRenderer.removeListener('ble:write', listener);
    },
    writeResult: (requestId: string, error: string | null) => ipcRenderer.send('ble:write-result', requestId, error),
    onDevices: (callback: (devices: Array<{ id: string; name: string }>) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, devices: Array<{ id: string; name: string }>) => callback(devices);
      ipcRenderer.on('ble:devices', listener);
      return () => ipcRenderer.removeListener('ble:devices', listener);
    },
  },
  system: {
    onSuspend: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('system:suspend', listener);
      return () => ipcRenderer.removeListener('system:suspend', listener);
    },
    onResume: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('system:resume', listener);
      return () => ipcRenderer.removeListener('system:resume', listener);
    },
  },
  messages: {
    onReceived: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('messages:received', listener);
      return () => ipcRenderer.removeListener('messages:received', listener);
    },
    saveGroups: (groups: { rf: string[]; aprsIs: string[] }, profileId: string): Promise<void> => ipcRenderer.invoke('config:save-message-groups', groups, profileId),
    get: (): Promise<AprsMessage[]> => ipcRenderer.invoke('messages:get'),
    markRead: (recipient: string): Promise<void> => ipcRenderer.invoke('messages:mark-read', recipient),
    deleteConversation: (recipient: string): Promise<void> => ipcRenderer.invoke('messages:delete-conversation', recipient),
    send: (message: {
      recipient: string;
      text: string;
      interfaceId: string;
      path: string;
    }, profileId: string): Promise<void> => ipcRenderer.invoke('messages:send', message, profileId),
    retry: (id: string, profileId: string): Promise<void> =>
      ipcRenderer.invoke('messages:retry', id, profileId),
    onChanged: (callback: (messages: AprsMessage[]) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        messages: AprsMessage[],
      ) => callback(messages);
      ipcRenderer.on('messages:changed', listener);
      return () => ipcRenderer.removeListener('messages:changed', listener);
    },
  },
  stations: {
    get: (): Promise<Station[]> => ipcRenderer.invoke('stations:get'),
    onChanged: (callback: (stations: Station[]) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        stations: Station[],
      ) => callback(stations);
      ipcRenderer.on('stations:changed', listener);
      return () => ipcRenderer.removeListener('stations:changed', listener);
    },
  },
  config: {
    saveMapTool: (tool: import('./components/Topbar').MapToolId, visible: boolean) => ipcRenderer.invoke('config:save-map-tool', tool, visible),
    sendStatus: (station: import('./stationProfiles').StationSettings, profileId: string): Promise<{ sent: string[]; failed: string[] }> => ipcRenderer.invoke('station:send-status', station, profileId),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),
    profileAction: (action: import('./stationProfiles').ProfileAction, profileId: string, station: import('./stationProfiles').StationSettings): Promise<Record<string, unknown>> => ipcRenderer.invoke('config:profile-action', action, profileId, station),
    onRuntimeChanged: (callback: (configuration: Record<string, unknown>) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, configuration: Record<string, unknown>) => callback(configuration);
      ipcRenderer.on('config:runtime-changed', listener);
      return () => ipcRenderer.removeListener('config:runtime-changed', listener);
    },
    saveClockMode: (mode: 'utc' | 'local') => ipcRenderer.invoke('config:save-clock-mode', mode),
    openMapProviders: (): Promise<void> => ipcRenderer.invoke('config:open-map-providers'),
    getMapCacheStats: (id: string): Promise<{ count: number; bytes: number }> => ipcRenderer.invoke('map:cache-stats', id),
    clearMapCache: (id: string): Promise<void> => ipcRenderer.invoke('map:clear-cache', id),
    saveMapSettings: (settings: import('./mapSettings').MapSettings) => ipcRenderer.invoke('config:save-map-settings', settings),
    saveMessageInterface: (id: string, profileId: string) => ipcRenderer.invoke('config:save-message-interface', id, profileId),
    saveMessagePath: (recipient: string, path: string, profileId: string) => ipcRenderer.invoke('config:save-message-path', recipient, path, profileId),
    updateTocalls: (): Promise<{ count: number; generationTime?: string }> => ipcRenderer.invoke('tocall:update'),
    exportBackup: (): Promise<boolean> => ipcRenderer.invoke('config:export-backup'),
    importBackup: (): Promise<boolean> => ipcRenderer.invoke('config:import-backup'),
    saveScrollerVisibility: (visible: boolean) => ipcRenderer.invoke('config:save-scroller-visibility', visible),
    saveMapMask: (settings: { light: number; dark: number }) =>
      ipcRenderer.invoke('config:save-map-mask', settings),
    saveMapViewport: (viewport: {
      latitude: number;
      longitude: number;
      zoom: number;
    }) => ipcRenderer.invoke('config:save-map-viewport', viewport),
    getActivePath: (): Promise<{
      path: string;
      storage: 'portable' | 'userData';
    }> => ipcRenderer.invoke('config:get-active-path'),
    get: (): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('config:get'),
    saveStation: (station: {
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
    }, profileId: string): Promise<{ path: string; storage: 'portable' | 'userData' }> =>
      ipcRenderer.invoke('config:save-station', station, profileId),
    sendBeacon: (station: {
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
    }, profileId: string): Promise<{ sent: string[]; failed: string[] }> => ipcRenderer.invoke('station:send-beacon', station, profileId),
    saveInterfaces: (
      interfaces: Array<{
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
      }>,
      profileId: string,
    ): Promise<{ path: string; storage: 'portable' | 'userData' }> =>
      ipcRenderer.invoke('config:save-interfaces', interfaces, profileId),
  },
  traffic: {
    saveLog: (filter: string): Promise<boolean> => ipcRenderer.invoke('traffic:save-log', filter),
    getRecent: (): Promise<
      Array<{
        id: string;
        receivedAt: string;
        interfaceId: string;
        interfaceName: string;
        packet: string;
        source: 'kiss' | 'aprs-is';
        direction: 'rx' | 'tx';
        category?: 'own-beacon' | 'own-weather' | 'own-message';
      }>
    > => ipcRenderer.invoke('traffic:get-recent'),
    getInterfaceStatuses: (): Promise<
      Record<string, 'connecting' | 'connected' | 'disconnected' | 'error'>
    > => ipcRenderer.invoke('traffic:get-interface-statuses'),
    onReceived: (
      callback: (frame: {
        id: string;
        receivedAt: string;
        interfaceId: string;
        interfaceName: string;
        packet: string;
        source: 'kiss' | 'aprs-is';
        direction: 'rx' | 'tx';
        category?: 'own-beacon' | 'own-weather' | 'own-message';
      }) => void,
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        frame: Parameters<typeof callback>[0],
      ) => callback(frame);
      ipcRenderer.on('traffic:received', listener);
      return () => ipcRenderer.removeListener('traffic:received', listener);
    },
    onInterfaceStatus: (
      callback: (status: {
        interfaceId: string;
        status: 'connecting' | 'connected' | 'disconnected' | 'error';
      }) => void,
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: Parameters<typeof callback>[0],
      ) => callback(status);
      ipcRenderer.on('traffic:interface-status', listener);
      return () =>
        ipcRenderer.removeListener('traffic:interface-status', listener);
    },
  },
});

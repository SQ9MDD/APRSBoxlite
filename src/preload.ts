import { contextBridge, ipcRenderer } from 'electron';
import type { Station, AprsMessage } from './types';

contextBridge.exposeInMainWorld('aprsbox', {
  messages: {
    get: (): Promise<AprsMessage[]> => ipcRenderer.invoke('messages:get'),
    send: (message: {
      recipient: string;
      text: string;
      interfaceId: string;
      path: string;
    }): Promise<void> => ipcRenderer.invoke('messages:send', message),
    retry: (id: string): Promise<void> =>
      ipcRenderer.invoke('messages:retry', id),
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
    }): Promise<{ path: string; storage: 'portable' | 'userData' }> =>
      ipcRenderer.invoke('config:save-station', station),
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
    }): Promise<void> => ipcRenderer.invoke('station:send-beacon', station),
    saveInterfaces: (
      interfaces: Array<{
        id: string;
        name: string;
        type: 'kiss-tcp' | 'kiss-serial';
        enabled: boolean;
        txBlocked: boolean;
        hostPort: string;
        serialDevice: string;
        baudRate: string;
        reconnectTimeout: string;
      }>,
    ): Promise<{ path: string; storage: 'portable' | 'userData' }> =>
      ipcRenderer.invoke('config:save-interfaces', interfaces),
  },
  traffic: {
    getRecent: (): Promise<
      Array<{
        id: string;
        receivedAt: string;
        interfaceId: string;
        interfaceName: string;
        packet: string;
        source: 'kiss';
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
        source: 'kiss';
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

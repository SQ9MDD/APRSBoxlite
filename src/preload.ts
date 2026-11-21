import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('aprsbox', {
  config: {
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
    }): Promise<{ path: string; storage: 'portable' | 'userData' }> =>
      ipcRenderer.invoke('config:save-station', station),
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

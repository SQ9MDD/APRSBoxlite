/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
/// <reference types="vite/client" />
declare module '*.css';
declare module '*.svg' {
  const source: string;
  export default source;
}

interface Window {
  aprsbox: {
    ble: {
      begin(): void;
      autoScan(): Promise<void>;
      remember(id: string, deviceId: string, name: string): Promise<void>;
      choose(id: string): void;
      status(id: string, status: 'connecting' | 'connected' | 'disconnected' | 'error'): void;
      receive(id: string, bytes: Uint8Array): void;
      onWrite(callback: (request: { requestId: string; interfaceId: string; bytes: Uint8Array }) => void): () => void;
      writeResult(requestId: string, error: string | null): void;
      onDevices(callback: (devices: Array<{ id: string; name: string }>) => void): () => void;
    };
    system: {
      onSuspend(callback: () => void): () => void;
      onResume(callback: () => void): () => void;
    };
    messages: {
      saveGroups(groups: { rf: string[]; aprsIs: string[] }): Promise<void>;
      get(): Promise<import('./types').AprsMessage[]>;
      markRead(recipient: string): Promise<void>;
      deleteConversation(recipient: string): Promise<void>;
      send(message: {
        recipient: string;
        text: string;
        interfaceId: string;
        path: string;
      }): Promise<void>;
      retry(id: string): Promise<void>;
      onChanged(
        callback: (messages: import('./types').AprsMessage[]) => void,
      ): () => void;
    };
    stations: {
      get(): Promise<import('./types').Station[]>;
      onChanged(
        callback: (stations: import('./types').Station[]) => void,
      ): () => void;
    };
    config: {
      openMapProviders(): Promise<void>;
      getMapCacheStats(id: string): Promise<{ count: number; bytes: number }>;
      clearMapCache(id: string): Promise<void>;
      saveMapSettings(settings: import('./mapSettings').MapSettings): Promise<{ path: string; storage: 'portable' | 'userData' }>;
      saveMessageInterface(id: string): Promise<{ path: string; storage: 'portable' | 'userData' }>;
      saveMessagePath(recipient: string, path: string): Promise<{ path: string; storage: 'portable' | 'userData' }>;
      updateTocalls(): Promise<{ count: number; generationTime?: string }>;
      exportBackup(): Promise<boolean>;
      importBackup(): Promise<boolean>;
      saveScrollerVisibility(visible: boolean): Promise<{ path: string; storage: 'portable' | 'userData' }>;
      saveMapMask(settings: {
        light: number;
        dark: number;
      }): Promise<{ path: string; storage: 'portable' | 'userData' }>;
      saveMapViewport(viewport: {
        latitude: number;
        longitude: number;
        zoom: number;
      }): Promise<{ path: string; storage: 'portable' | 'userData' }>;
      getActivePath(): Promise<{
        path: string;
        storage: 'portable' | 'userData';
      }>;
      get(): Promise<Record<string, unknown>>;
      saveStation(station: {
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
      }): Promise<{ path: string; storage: 'portable' | 'userData' }>;
      sendBeacon(station: {
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
      }): Promise<{ sent: string[]; failed: string[] }>;
      saveInterfaces(
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
      ): Promise<{ path: string; storage: 'portable' | 'userData' }>;
    };
    traffic: {
      saveLog(filter: string): Promise<boolean>;
      getRecent(): Promise<
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
      >;
      getInterfaceStatuses(): Promise<
        Record<string, 'connecting' | 'connected' | 'disconnected' | 'error'>
      >;
      onReceived(
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
      ): () => void;
      onInterfaceStatus(
        callback: (status: {
          interfaceId: string;
          status: 'connecting' | 'connected' | 'disconnected' | 'error';
        }) => void,
      ): () => void;
    };
  };
}

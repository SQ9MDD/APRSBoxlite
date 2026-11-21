/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
/// <reference types="vite/client" />
declare module '*.css';
declare module '*.svg' {
  const source: string;
  export default source;
}

interface Window {
  aprsbox: {
    messages: {
      get(): Promise<import('./types').AprsMessage[]>;
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
      }): Promise<void>;
      saveInterfaces(
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
      ): Promise<{ path: string; storage: 'portable' | 'userData' }>;
    };
    traffic: {
      getRecent(): Promise<
        Array<{
          id: string;
          receivedAt: string;
          interfaceId: string;
          interfaceName: string;
          packet: string;
          source: 'kiss';
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
          source: 'kiss';
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

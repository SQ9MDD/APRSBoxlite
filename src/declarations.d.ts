/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
declare module '*.svg' {
  const source: string;
  export default source;
}

interface Window {
  aprsbox: {
    config: {
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
      }): Promise<{ path: string; storage: 'portable' | 'userData' }>;
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

export type AppView = 'map' | 'stations' | 'traffic' | 'messages' | 'settings';

export type StationKind = 'home' | 'mobile' | 'weather' | 'digipeater';

export interface Station {
  callsign: string;
  name: string;
  kind: StationKind;
  latitude: number;
  longitude: number;
  lastHeard: string;
  comment: string;
  course?: string;
  speed?: string;
  symbol: string;
}

export interface Packet {
  source: string;
  destination: string;
  path: string;
  receivedAt: string;
  type: string;
  raw: string;
}

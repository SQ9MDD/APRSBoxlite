export type AppView = 'map' | 'stations' | 'traffic' | 'messages' | 'settings';

export interface AprsMessage {
  id: string;
  sender: string;
  recipient: string;
  text: string;
  direction: 'rx' | 'tx';
  status: 'received' | 'pending' | 'sent' | 'acked' | 'rejected' | 'failed';
  number?: string;
  path: string;
  interfaceId: string;
  attempts: number;
  createdAt: string;
  error?: string;
}

export type StationKind =
  | 'station'
  | 'home'
  | 'mobile'
  | 'weather'
  | 'digipeater';

export interface AprsDecodedData {
  courseDegrees?: number;
  speedKnots?: number;
  altitudeFeet?: number;
  phg?: {
    powerWatts: number;
    heightFeet: number;
    gainDbi: number;
    direction: number;
  };
  qsy?: { frequencyMHz: number; tone?: string; offsetKHz?: number };
  weather?: {
    temperatureC?: number;
    humidityPercent?: number;
    pressureHpa?: number;
    windDegrees?: number;
    windMph?: number;
    gustMph?: number;
  };
}

export interface Station {
  callsign: string;
  name: string;
  kind: StationKind;
  latitude: number;
  longitude: number;
  lastHeard: string;
  positionReceivedAt?: string;
  comment: string;
  course?: string;
  speed?: string;
  symbol: string;
  aprsClient?: string;
  destination?: string;
  path?: string;
  sourceInterface?: string;
  decoded?: AprsDecodedData;
  track: Array<{ latitude: number; longitude: number; receivedAt: number }>;
  phg?: { rangeKm: number; direction: number };
}

export interface Packet {
  source: string;
  destination: string;
  path: string;
  receivedAt: string;
  type: string;
  raw: string;
}

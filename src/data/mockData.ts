import type { Packet, Station } from '../types';

export const mockStations: Station[] = [
  {
    callsign: 'SQ9MDD-8',
    name: 'APRSBox Home',
    kind: 'home',
    latitude: 50.0413,
    longitude: 19.9639,
    lastHeard: 'now',
    comment: 'APRSBox Lite station',
    symbol: '⌂',
  },
  {
    callsign: 'SP9XYZ-7',
    name: 'Kraków mobile',
    kind: 'mobile',
    latitude: 50.0619,
    longitude: 19.9383,
    lastHeard: '18 sec ago',
    comment: 'En route through the city',
    course: '042°',
    speed: '48 km/h',
    symbol: '▸',
  },
  {
    callsign: 'SR9WX-3',
    name: 'Kraków weather',
    kind: 'weather',
    latitude: 50.0831,
    longitude: 19.9685,
    lastHeard: '2 min ago',
    comment: '12.4°C · 68% humidity · light wind',
    symbol: '☼',
  },
  {
    callsign: 'SR9DIGI',
    name: 'Wawel relay',
    kind: 'digipeater',
    latitude: 50.0545,
    longitude: 19.9354,
    lastHeard: '5 min ago',
    comment: 'Wide coverage node',
    symbol: '◆',
  },
  {
    callsign: 'SP9CAR-9',
    name: 'Nowa Huta mobile',
    kind: 'mobile',
    latitude: 50.0768,
    longitude: 20.0331,
    lastHeard: '7 min ago',
    comment: 'Heading east on route 79',
    course: '088°',
    speed: '66 km/h',
    symbol: '▸',
  },
];

export const latestPacket: Packet = {
  source: 'SP9XYZ-7',
  destination: 'APRS',
  path: 'WIDE1-1,WIDE2-1',
  receivedAt: '10:42:18 UTC',
  type: 'Position',
  raw: 'SP9XYZ-7>APRS,WIDE1-1,WIDE2-1:!5003.71N/01956.30E>042/026 Kraków mobile',
};

export const mockTraffic = [
  {
    time: '10:42:18',
    source: 'SP9XYZ-7',
    type: 'Position',
    path: 'WIDE1-1,WIDE2-1',
  },
  { time: '10:41:56', source: 'SR9WX-3', type: 'Weather', path: 'TCPIP*' },
  { time: '10:40:03', source: 'SQ9MDD-8', type: 'Beacon', path: 'WIDE1-1' },
  { time: '10:38:44', source: 'SP9CAR-9', type: 'Position', path: 'WIDE2-1' },
];

import type { Packet } from '../types';

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

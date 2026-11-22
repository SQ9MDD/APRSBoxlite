import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {
  KissFrameDecoder,
  KissTcpRxService,
  decodeAx25ToTnc2,
} from '../src/main/kissTcpRx.ts';

function ax25Address(callsign: string, ssid: number, last: boolean): Buffer {
  const padded = callsign.padEnd(6, ' ').slice(0, 6);
  return Buffer.from([
    ...Array.from(padded, (character) => character.charCodeAt(0) << 1),
    0x60 | (ssid << 1) | (last ? 1 : 0),
  ]);
}

function kissFrame(payload: Buffer): Buffer {
  const escaped = Buffer.from(
    [...payload].flatMap((byte) => {
      if (byte === 0xc0) return [0xdb, 0xdc];
      if (byte === 0xdb) return [0xdb, 0xdd];
      return [byte];
    }),
  );
  return Buffer.concat([
    Buffer.from([0xc0, 0x00]),
    escaped,
    Buffer.from([0xc0]),
  ]);
}

test('decodes an AX.25 UI frame to TNC2', () => {
  const payload = Buffer.concat([
    ax25Address('APRS', 0, false),
    ax25Address('SP5ABC', 1, true),
    Buffer.from([0x03, 0xf0]),
    Buffer.from('>Test beacon'),
  ]);
  assert.equal(decodeAx25ToTnc2(payload), 'SP5ABC-1>APRS:>Test beacon');
});

test('buffers fragmented and escaped KISS frames', () => {
  const payload = Buffer.concat([
    ax25Address('APRS', 0, false),
    ax25Address('SP5ABC', 1, true),
    Buffer.from([0x03, 0xf0]),
    Buffer.from('>DB'),
    Buffer.from([0xdb]),
  ]);
  const frame = kissFrame(payload);
  const decoder = new KissFrameDecoder();
  assert.deepEqual(decoder.consume(frame.subarray(0, 9)), []);
  assert.deepEqual(decoder.consume(frame.subarray(9)), ['SP5ABC-1>APRS:>DB�']);
});

test('ignores non-data KISS commands', () => {
  const decoder = new KissFrameDecoder();
  assert.deepEqual(decoder.consume(Buffer.from([0xc0, 0x01, 0x00, 0xc0])), []);
});

test('receives a fragmented KISS TCP frame', async (context) => {
  const payload = Buffer.concat([
    ax25Address('APRS', 0, false),
    ax25Address('SP5ABC', 1, true),
    Buffer.from([0x03, 0xf0]),
    Buffer.from('>TCP RX'),
  ]);
  const frame = kissFrame(payload);
  const server = net.createServer((socket) => {
    socket.write(frame.subarray(0, 8));
    socket.end(frame.subarray(8));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('The sandbox does not permit a local TCP listener.');
      return;
    }
    throw error;
  }
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const received = await new Promise<string>((resolve, reject) => {
    const service = new KissTcpRxService(
      (entry) => {
        service.stop();
        resolve(entry.packet);
      },
      () => undefined,
    );
    service.configure([
      {
        id: 'test',
        name: 'Test TNC',
        type: 'kiss-tcp',
        enabled: true,
        hostPort: `127.0.0.1:${address.port}`,
      },
    ]);
    setTimeout(() => {
      service.stop();
      reject(new Error('Timed out waiting for KISS TCP frame.'));
    }, 1_000).unref();
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(received, 'SP5ABC-1>APRS:>TCP RX');
});

test('sends on the existing KISS TCP socket and respects TX block', async (context) => {
  let resolveReceived: (frame: Buffer) => void = () => undefined;
  const received = new Promise<Buffer>((resolve) => {
    resolveReceived = resolve;
  });
  const server = net.createServer((socket) => {
    socket.once('data', resolveReceived);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('The sandbox does not permit a local TCP listener.');
      return;
    }
    throw error;
  }
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let connected: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    connected = resolve;
  });
  const service = new KissTcpRxService(
    () => undefined,
    (_id, status) => {
      if (status === 'connected') connected();
    },
  );
  const config = {
    id: 'tcp',
    name: 'TNC',
    type: 'kiss-tcp' as const,
    enabled: true,
    txBlocked: true,
    hostPort: `127.0.0.1:${address.port}`,
  };
  try {
    service.configure([config]);
    await ready;
    await assert.rejects(
      service.transmit('tcp', Uint8Array.from([0xc0, 0, 0xc0])),
      /blocked/,
    );
    service.configure([{ ...config, txBlocked: false }]);
    const frame = kissFrame(Buffer.concat([
      ax25Address('APRS', 0, false), ax25Address('SP5ABC', 1, true),
      Buffer.from([0x03, 0xf0]), Buffer.from('>Test TX'),
    ]));
    await service.transmit('tcp', frame);
    assert.deepEqual(await received, frame);
    assert.equal(service.getHistory()[0]?.direction, 'tx');
    assert.equal(service.getHistory()[0]?.packet, 'SP5ABC-1>APRS:>Test TX');
  } finally {
    service.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('reconnects after a dropped connection and after resume', async (context) => {
  const connections: net.Socket[] = [];
  const server = net.createServer((socket) => { connections.push(socket); });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('The sandbox does not permit a local TCP listener.');
      return;
    }
    throw error;
  }
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let count = 0;
  let notify: (() => void) | undefined;
  const service = new KissTcpRxService(() => undefined, (_id, status) => {
    if (status === 'connected') {
      count += 1;
      notify?.();
    }
  });
  const waitForConnection = (target: number) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Reconnect timed out')), 4000);
    notify = () => {
      if (count >= target) {
        clearTimeout(timeout);
        notify = undefined;
        resolve();
      }
    };
    notify();
  });
  try {
    service.configure([{ id: 'tcp', name: 'TNC', type: 'kiss-tcp', enabled: true,
      hostPort: `127.0.0.1:${address.port}`, reconnectTimeout: '1' }]);
    await waitForConnection(1);
    connections[0].destroy();
    await waitForConnection(2);
    service.reconnectAfterResume();
    await waitForConnection(3);
  } finally {
    service.stop();
    connections.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

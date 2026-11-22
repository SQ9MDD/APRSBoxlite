import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { SerialPortMock } from 'serialport';
import type { SerialPort } from 'serialport';
import type { TrafficFrame } from '../src/main/kissTcpRx.ts';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier === './kissTcpRx' ? `${specifier}.ts` : specifier, context);
} });
const { KissSerialRxService } = await import('../src/main/kissSerialRx.ts');

const config = { id: 'serial', name: 'TNC', type: 'kiss-serial' as const, enabled: true, txBlocked: false, serialDevice: '/dev/mock-tnc', baudRate: '9600', reconnectTimeout: '1' };
const frame = Buffer.from([0xc0, 0, ...Buffer.from('APRS  ').map((c) => c << 1), 0x60, ...Buffer.from('SP5ABC').map((c) => c << 1), 0x63, 3, 0xf0, ...Buffer.from('>Serial RX'), 0xc0]);

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for serial operation.');
}

test('receives fragmented serial KISS frames, transmits, blocks TX and reconnects after resume', async () => {
  SerialPortMock.binding.reset();
  SerialPortMock.binding.createPort(config.serialDevice, { record: true });
  let port: SerialPortMock;
  const frames: TrafficFrame[] = [];
  const service = new KissSerialRxService((entry) => frames.push(entry), () => undefined, (path, baudRate) => {
    port = new SerialPortMock({ path, baudRate, autoOpen: false });
    return port as unknown as SerialPort;
  });
  try {
    service.configure([config]);
    await waitFor(() => service.getStatuses().serial === 'connected');
    port!.port!.emitData(frame.subarray(0, 8));
    port!.port!.emitData(frame.subarray(8));
    await waitFor(() => frames.length === 1);
    assert.equal(frames[0].packet, 'SP5ABC-1>APRS:>Serial RX');
    assert.equal(frames[0].direction, 'rx');
    await service.transmit(config.id, frame);
    assert.deepEqual(port!.port!.recording, frame);
    assert.equal(frames[1].direction, 'tx');
    service.configure([{ ...config, txBlocked: true }]);
    await assert.rejects(service.transmit(config.id, frame), /blocked/);
    const oldPort = port!;
    service.reconnectAfterResume();
    await waitFor(() => port !== oldPort && service.getStatuses().serial === 'connected');
    assert.equal(oldPort.isOpen, false);
    assert.equal(service.getHistory().length, 2);
  } finally {
    service.stop();
  }
});

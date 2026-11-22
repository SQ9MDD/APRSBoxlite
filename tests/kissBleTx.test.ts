import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier === './kissTcpRx' ? `${specifier}.ts` : specifier, context);
} });
const { KissBleRxService } = await import('../src/main/kissBleRx.ts');

test('BLE TX checks permission and connection and logs only successful KISS writes', async () => {
  const traffic: Array<{ direction: string; packet: string }> = [];
  const writes: Uint8Array[] = [];
  let fail = false;
  const service = new KissBleRxService((frame) => traffic.push(frame), () => undefined, async (_id, bytes) => {
    if (fail) throw new Error('write failed');
    writes.push(bytes);
  });
  const config = { id: 'ble', name: 'BLE TNC', type: 'kiss-ble', enabled: true, txBlocked: false };
  const frame = Buffer.from([0xc0, 0, ...Buffer.from('APBOX1').map((c) => c << 1), 0x60, ...Buffer.from('SP5ABC').map((c) => c << 1), 0x63, 3, 0xf0, ...Buffer.from('>Test'), 0xc0]);
  service.configure([config]);
  await assert.rejects(service.transmit('ble', frame), /not connected/);
  service.status('ble', 'connected');
  service.configure([{ ...config, txBlocked: true }]);
  await assert.rejects(service.transmit('ble', frame), /blocked/);
  service.configure([config]);
  fail = true;
  await assert.rejects(service.transmit('ble', frame), /write failed/);
  assert.equal(traffic.length, 0);
  fail = false;
  await service.transmit('ble', frame);
  assert.deepEqual(writes, [frame]);
  assert.equal(traffic[0].direction, 'tx');
  assert.match(traffic[0].packet, /^SP5ABC-1>APBOX1:/);
});

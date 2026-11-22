import assert from 'node:assert/strict';
import test from 'node:test';

const sent: number[][] = [];
const characteristic = Object.assign(new EventTarget(), {
  startNotifications: async () => characteristic,
  writeValueWithoutResponse: async (bytes: Uint8Array) => { sent.push([...bytes]); },
});
const gatt = {
  connected: false,
  async connect() { this.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }; },
  disconnect() { this.connected = false; },
};
const device = Object.assign(new EventTarget(), { name: 'Test', gatt });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth: { requestDevice: async () => device } } });
Object.defineProperty(globalThis, 'window', { configurable: true, value: { aprsbox: { ble: { begin() {}, choose() {}, status() {}, receive() {} } } } });
const { scanBle, reconcileBle, transmitBle, disconnectBle, hasBleLink, isAnyBleScanning } = await import('../src/bleTransport.ts');

test('BLE writes are chunked in order without interleaving and respect TX block', async () => {
  reconcileBle([{ id: 'ble', type: 'kiss-ble', enabled: true, txBlocked: false }]);
  scanBle('ble', '5', () => undefined);
  assert.equal(isAnyBleScanning(), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    assert.equal(isAnyBleScanning(), false);
    assert.equal(hasBleLink('ble'), true);
    await Promise.all([transmitBle('ble', new Uint8Array(25).fill(1)), transmitBle('ble', new Uint8Array(2).fill(2))]);
    assert.deepEqual(sent.map((chunk) => [chunk.length, chunk[0]]), [[20, 1], [5, 1], [2, 2]]);
    reconcileBle([{ id: 'ble', type: 'kiss-ble', enabled: true, txBlocked: true }]);
    await assert.rejects(transmitBle('ble', new Uint8Array([1])), /blocked/);
  } finally { disconnectBle('ble'); }
  assert.equal(hasBleLink('ble'), false);
});

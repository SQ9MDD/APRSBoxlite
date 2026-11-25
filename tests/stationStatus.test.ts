import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    return next(['./aprsPosition', './tocalls', './aprsExtensions'].includes(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const { StationStore } = await import('../src/main/stationStore.ts');

test('associates status frames with the originating station and retains position comments', () => {
  const store = new StationStore(() => {});
  try {
    store.receive('SP8ABC>APRS:>251030zOn air');
    store.receive('SP8ABC>APRS:!5228.23N/02101.28E>Position comment');
    assert.equal(store.snapshot()[0]?.status, 'On air');
    assert.equal(store.snapshot()[0]?.comment, 'Position comment');
    store.receive('SP8ABC>APRS:>New status');
    assert.equal(store.snapshot()[0]?.status, 'New status');
    store.receive('SP8ABC>APRS:!5228.23N/02101.28E>Updated comment');
    assert.equal(store.snapshot()[0]?.status, 'New status');
    assert.equal(store.snapshot()[0]?.comment, 'Updated comment');
    store.receive('SP8ABC>APRS:;OBJECT   *010203z5228.23N/02101.28E#Object comment');
    assert.equal(store.snapshot().find((station) => station.callsign === 'OBJECT')?.status, undefined);
  } finally { store.dispose(); }
});

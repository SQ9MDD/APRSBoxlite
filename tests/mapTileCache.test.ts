import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MapTileCache } from '../src/main/mapTileCache.ts';
import type { MapSource } from '../src/mapSettings.ts';

const source: MapSource = { id: 'osm', name: 'Test', url: 'https://example.test/{z}/{x}/{y}.png', attribution: '', minZoom: 0, maxZoom: 19, enabled: true, cacheEnabled: true };
const image = Uint8Array.from([137, 80, 78, 71, 1, 2]);
const tile = 'aprsbox-tile://tiles/osm/2/1/2';

test('caches tiles per source, counts and clears them, and does not reuse a changed URL', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aprsbox-map-cache-'));
  const configured = { ...source };
  let downloads = 0;
  const cache = new MapTileCache(() => directory, () => [configured], async () => {
    downloads++;
    return new Response(image, { headers: { 'Content-Type': 'image/png' } });
  });
  try {
    const [first, second] = await Promise.all([cache.respond(tile), cache.respond(tile)]);
    assert.deepEqual(new Uint8Array(await first.arrayBuffer()), image);
    assert.equal(second.headers.get('content-type'), 'image/png');
    assert.equal(downloads, 1);
    assert.deepEqual(await cache.stats('osm'), { count: 1, bytes: image.length });
    await cache.respond(tile);
    assert.equal(downloads, 1);
    configured.url = 'https://other.test/{z}/{x}/{y}.png';
    await cache.respond(tile);
    assert.equal(downloads, 2);
    assert.equal((await cache.stats('osm')).count, 2);
    await cache.clear('osm');
    assert.deepEqual(await cache.stats('osm'), { count: 0, bytes: 0 });
    configured.cacheEnabled = false;
    assert.equal((await cache.respond(tile)).status, 404);
    assert.equal(downloads, 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('rejects invalid tile coordinates and never caches non-image responses', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aprsbox-map-cache-'));
  const cache = new MapTileCache(() => directory, () => [source], async () => new Response('error page', { headers: { 'Content-Type': 'text/html' } }));
  try {
    assert.equal((await cache.respond('aprsbox-tile://tiles/osm/2/4/0')).status, 400);
    assert.equal((await cache.respond('aprsbox-tile://tiles/osm/2/1/2?x=1')).status, 400);
    assert.equal((await cache.respond(tile)).status, 502);
    assert.equal((await cache.stats('osm')).count, 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('does not save an in-flight tile after the cache is cleared', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aprsbox-map-cache-'));
  let finish: (response: Response) => void = () => undefined;
  let notifyStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  const cache = new MapTileCache(() => directory, () => [source], () => new Promise((resolve) => { finish = resolve; notifyStarted(); }));
  try {
    const pending = cache.respond(tile);
    await started;
    const clearing = cache.clear('osm');
    finish(new Response(image, { headers: { 'Content-Type': 'image/png' } }));
    await pending;
    await clearing;
    assert.equal((await cache.stats('osm')).count, 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

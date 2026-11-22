import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bundled from '../src/data/tocalls.json' with { type: 'json' };

registerHooks({ resolve(specifier, context, next) {
  return next(['./tocalls', './configStorage'].includes(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { updateTocalls, loadSavedTocalls } = await import('../src/main/tocallUpdate.ts');
const { lookupTocall, replaceTocallDatabase } = await import('../src/main/tocalls.ts');

test('downloads and validates the APRS Foundation TOCALL database', async () => {
  try {
    const result = await updateTocalls(async (url) => {
      assert.equal(url, 'https://aprs-deviceid.aprsfoundation.org/tocalls.pretty.json');
      return new Response(JSON.stringify({ meta: { generation_time: '2026-01-01' }, tocalls: { APNEW1: { model: 'Updated' } } }));
    });
    assert.equal(result.generationTime, '2026-01-01');
    assert.equal(lookupTocall('APNEW1'), 'Updated');
    await assert.rejects(updateTocalls(async () => new Response('error', { status: 503 })), /503/);
    await assert.rejects(updateTocalls(async () => new Response('{"tocalls":{}}')), /empty/);
    assert.equal(lookupTocall('APNEW1'), 'Updated');
  } finally { replaceTocallDatabase(bundled); }
});

test('saves updates beside the configuration and reloads them on startup', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aprsbox-tocalls-'));
  const file = path.join(directory, 'tocalls.json');
  try {
    assert.equal(await loadSavedTocalls(file), false);
    await updateTocalls(async () => new Response(JSON.stringify({ tocalls: { APNEW1: { model: 'Saved device' } } })), file);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).tocalls.APNEW1.model, 'Saved device');
    replaceTocallDatabase(bundled);
    assert.equal(lookupTocall('APNEW1'), undefined);
    assert.equal(await loadSavedTocalls(file), true);
    assert.equal(lookupTocall('APNEW1'), 'Saved device');
    await assert.rejects(updateTocalls(async () => new Response('{"tocalls":{}}'), file), /empty/);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).tocalls.APNEW1.model, 'Saved device');
    await fs.writeFile(file, '{invalid');
    await assert.rejects(loadSavedTocalls(file));
    assert.equal(lookupTocall('APNEW1'), 'Saved device');
  } finally { replaceTocallDatabase(bundled); await fs.rm(directory, { recursive: true, force: true }); }
});

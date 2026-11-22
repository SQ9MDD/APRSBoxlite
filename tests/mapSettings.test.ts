import assert from 'node:assert/strict';
import test from 'node:test';
import { activeMapSource, DEFAULT_MAP_SETTINGS, mapTileUrl, validateMapSettings } from '../src/mapSettings.ts';
import { createConfigurationBackup, readConfigurationBackup } from '../src/main/configBackup.ts';

test('validates map opacity, sources and enabled default', () => {
  const settings = structuredClone(DEFAULT_MAP_SETTINGS);
  assert.equal(activeMapSource(validateMapSettings(settings)).name, 'OpenStreetMap');
  assert.equal(validateMapSettings(settings).sources[0].cacheEnabled, false);
  assert.equal(mapTileUrl({ ...settings.sources[0], cacheEnabled: true }), 'aprsbox-tile://tiles/osm/{z}/{x}/{y}');
  settings.sources.push({ id: 'other', name: 'Other', url: 'https://{s}.example.org/{z}/{x}/{y}.png', attribution: 'Tiles', minZoom: 1, maxZoom: 18, enabled: true });
  settings.defaultSourceId = 'other';
  settings.coverageFillOpacity = 20;
  assert.equal(activeMapSource(validateMapSettings(settings)).id, 'other');
  assert.throws(() => validateMapSettings({ ...settings, coverageFillOpacity: 21 }));
  assert.throws(() => validateMapSettings({ ...settings, sources: [{ ...settings.sources[1], cacheEnabled: 'yes' }] }));
  assert.throws(() => validateMapSettings({ ...settings, defaultSourceId: 'missing' }));
  assert.throws(() => validateMapSettings({ ...settings, sources: settings.sources.map((item) => ({ ...item, enabled: false })) }));
  assert.throws(() => validateMapSettings({ ...settings, sources: [{ ...settings.sources[1], url: 'file:///tmp/{z}/{x}/{y}' }] }));
  assert.throws(() => validateMapSettings({ ...settings, sources: [{ ...settings.sources[1], url: 'https://example.com/{z}/{x}.png' }] }));
});

test('exports and validates a configuration-only backup', () => {
  const settings = { station: { callsign: 'SP9ABC' }, mapSettings: structuredClone(DEFAULT_MAP_SETTINGS), interfaces: [] };
  const backup = createConfigurationBackup(settings);
  assert.deepEqual(readConfigurationBackup(JSON.parse(JSON.stringify(backup))), settings);
  assert.throws(() => readConfigurationBackup({ version: 1, configuration: settings }));
  assert.throws(() => readConfigurationBackup({ format: 'APRSBoxLite-configuration', version: 2, configuration: settings }));
});

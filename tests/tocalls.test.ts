import assert from 'node:assert/strict';
import test from 'node:test';
import { identifyAprsDevice, lookupTocall, replaceTocallDatabase } from '../src/main/tocalls.ts';
import bundled from '../src/data/tocalls.json' with { type: 'json' };

test('identifies exact and wildcard TOCALLs from the bundled APRSBox list', () => {
  assert.equal(lookupTocall('APIZCI'), 'hymTR IZCI Tracker');
  assert.equal(lookupTocall('apdw16-1'), 'DireWolf');
  assert.equal(lookupTocall('UNKNOWN'), undefined);
});

test('updates exact and wildcard TOCALLs without replacing valid data on error', () => {
  try {
    const result = replaceTocallDatabase({ tocalls: { 'APNEW?': { model: 'New device', vendor: 'Test' } }, mice: {}, micelegacy: {}, classes: {} });
    assert.equal(result.count, 1);
    assert.equal(lookupTocall('APNEW1'), 'New device');
    assert.throws(() => replaceTocallDatabase({ tocalls: {} }), /empty/);
    assert.throws(() => replaceTocallDatabase({ tocalls: { APBAD1: { model: 42 } } }), /metadata/);
    assert.equal(lookupTocall('APNEW1'), 'New device');
  } finally { replaceTocallDatabase(bundled); }
  assert.equal(lookupTocall('APDW16'), 'DireWolf');
});

test('returns TOCALL metadata and Mic-E device identifiers like APRSBox', () => {
  const tocall = identifyAprsDevice('apdw16-1');
  assert.equal(tocall?.actualIdentifier, 'APDW16');
  assert.equal(tocall?.matchedPattern, 'APDW??');
  assert.equal(tocall?.vendor, 'WB2OSZ');
  const micE = identifyAprsDevice('ABCDEF', '`ABCDEFGHtext_0');
  assert.equal(micE?.identifierKind, 'mic-e');
  assert.equal(micE?.model, 'FT3D');
  assert.equal(micE?.vendor, 'Yaesu');
  assert.equal(micE?.classLabel, 'Handheld APRS client');
  const legacy = identifyAprsDevice('ABCDEF', '`ABCDEFGH>text&');
  assert.equal(legacy?.model, 'TH-D75');
  assert.deepEqual(legacy?.features, ['messaging']);
  assert.equal(identifyAprsDevice('UNKNOWN', '>status'), undefined);
});

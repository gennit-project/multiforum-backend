import test from 'node:test';
import assert from 'node:assert/strict';
import { stringFromUpdate } from './stringUpdate.js';

test('string updates normalize v7 SET and legacy string assignments', () => {
  for (const value of ['text', '']) {
    assert.equal(stringFromUpdate(value), value);
    assert.equal(stringFromUpdate({ set: value }), value);
  }
  assert.equal(stringFromUpdate({ set: null }), null);
});

test('absent updates are distinct from an explicit null assignment', () => {
  for (const value of [undefined, null, {}, { set: undefined }]) {
    assert.equal(stringFromUpdate(value), undefined);
  }
});

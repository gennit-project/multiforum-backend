import test from 'node:test';
import assert from 'node:assert/strict';
import { getNewMentionUsernames } from '../hooks/userMentionNotificationHook.js';

test('getNewMentionUsernames returns only newly added mentions', () => {
  const before = 'hello u/alice and u/bob';
  const after = 'hello u/alice and u/bob and u/carl';
  const newMentions = getNewMentionUsernames(before, after);
  assert.deepEqual(newMentions, ['carl']);
});

test('getNewMentionUsernames ignores removed mentions', () => {
  const before = 'u/alice u/bob';
  const after = 'u/alice';
  const newMentions = getNewMentionUsernames(before, after);
  assert.deepEqual(newMentions, []);
});

test('getNewMentionUsernames ignores case-only changes and duplicates', () => {
  const before = 'u/Alice';
  const after = 'u/alice u/ALICE u/bob';
  const newMentions = getNewMentionUsernames(before, after);
  assert.deepEqual(newMentions, ['bob']);
});


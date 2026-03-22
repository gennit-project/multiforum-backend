import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUserMentions } from './userMentionParser.js';

test('parseUserMentions finds unique u/username and @username mentions', () => {
  const text = 'hello u/alice and @Bob and u/alice again and @bob again';
  const mentions = parseUserMentions(text);
  const usernames = mentions.map((m) => m.username);
  assert.deepEqual(usernames, ['alice', 'Bob']);
});

test('parseUserMentions ignores inline code and code fences', () => {
  const text = 'mention u/alice and `u/bob` and ```\ncode u/carl\n``` end';
  const mentions = parseUserMentions(text);
  const usernames = mentions.map((m) => m.username);
  assert.deepEqual(usernames, ['alice']);
});

test('parseUserMentions ignores markdown links and autolinks', () => {
  const text =
    'see [link u/alice](https://example.com/u/alice) and <https://example.com/u/bob> and u/carl';
  const mentions = parseUserMentions(text);
  const usernames = mentions.map((m) => m.username);
  assert.deepEqual(usernames, ['carl']);
});

test('parseUserMentions ignores raw urls', () => {
  const text = 'https://example.com/u/alice u/bob www.example.com/u/carl';
  const mentions = parseUserMentions(text);
  const usernames = mentions.map((m) => m.username);
  assert.deepEqual(usernames, ['bob']);
});

test('parseUserMentions does not treat email addresses as mentions', () => {
  const text = 'email me at alice@example.com and tag @bob';
  const mentions = parseUserMentions(text);
  const usernames = mentions.map((m) => m.username);
  assert.deepEqual(usernames, ['bob']);
});

test('parseUserMentions returns empty array for null/undefined', () => {
  assert.deepEqual(parseUserMentions(null), []);
  assert.deepEqual(parseUserMentions(undefined), []);
  assert.deepEqual(parseUserMentions(''), []);
});

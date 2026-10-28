import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import type {Driver} from 'neo4j-driver';
import {ensureFulltextIndexes, fulltextIndexStatements} from '../../services/fulltextIndexes.js';
import {startNeo4j, stopNeo4j} from './neo4jHarness.js';

// v7 (campaign #284): the server creates the @fulltext indexes itself at startup
// because v7's assertIndexesAndConstraints only checks for them. Prove the
// creation works on a database that lacks them, and that it is idempotent.
let driver: Driver;
const NAMES = ['wikiPageFulltext', 'channelFulltext', 'discussionFulltext', 'issueFulltext'];

before(async () => {
  driver = await startNeo4j();
}, {timeout: 240000});
after(async () => stopNeo4j());

const fulltextIndexNames = async (): Promise<string[]> =>
  (await driver.executeQuery(
    `SHOW INDEXES YIELD name, type WHERE type = 'FULLTEXT' RETURN name ORDER BY name`
  )).records.map((r) => r.get('name') as string);

test('ensureFulltextIndexes creates every declared @fulltext index on a fresh DB', async () => {
  // Start from a DB that lacks them (the reused container may already have them).
  for (const name of NAMES) {
    await driver.executeQuery(`DROP INDEX ${name} IF EXISTS`);
  }
  const before = await fulltextIndexNames();
  for (const name of NAMES) assert.ok(!before.includes(name), `precondition: ${name} absent`);

  await ensureFulltextIndexes(driver);

  const after = await fulltextIndexNames();
  for (const name of NAMES) assert.ok(after.includes(name), `created: ${name}`);
});

test('ensureFulltextIndexes is idempotent (safe to run every startup)', async () => {
  await ensureFulltextIndexes(driver);
  await ensureFulltextIndexes(driver); // second run must not throw
  const names = await fulltextIndexNames();
  for (const name of NAMES) {
    assert.equal(names.filter((n) => n === name).length, 1, `${name} not duplicated`);
  }
});

test('every declared statement uses IF NOT EXISTS (idempotent by construction)', () => {
  assert.equal(fulltextIndexStatements.length, NAMES.length);
  for (const statement of fulltextIndexStatements) {
    assert.match(statement, /CREATE FULLTEXT INDEX \w+ IF NOT EXISTS FOR/);
  }
});

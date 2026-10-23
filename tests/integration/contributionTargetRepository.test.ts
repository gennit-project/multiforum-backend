import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { createContributionTargetRepository } from "../../services/persistence/contributionTargetRepository.js";
import {
  installRequestScopedBookmarks,
  runWithRequestBookmarks,
  getRequestBookmarkManager,
} from "../../services/requestScopedBookmarks.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = installRequestScopedBookmarks(await startNeo4j());
  const app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({
    typeDefs,
    driver,
    resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  await neoSchema.getSchema();
}, { timeout: 240_000 });

beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());

// Compare with the exact pre-migration selections, using the production shared
// schema rather than OGM's standalone schema that strips authorization.
test("contribution targets match production OGM existence for all target kinds", async (t) => {
  await driver.executeQuery(`
    CREATE (:User {username: 'alice'})
    CREATE (:User {username: ' spaced user '})
    CREATE (:ModerationProfile {displayName: 'Mod One'})
    CREATE (:ModerationProfile {displayName: ' spaced mod '})
    CREATE (:Channel {uniqueName: 'cats', deleted: true, locked: true})
    CREATE (:Channel {uniqueName: ' spaced channel '})
  `);
  const repository = createContributionTargetRepository(driver);
  for (const name of ["alice", " spaced user ", "missing", "ALICE", "", "' OR true"]) {
    t.assert.snapshot({ name, exists: await repository.userExists(name) });
  }
  for (const name of ["Mod One", " spaced mod ", "missing", "mod one", ""]) {
    t.assert.snapshot({ name, exists: await repository.moderationProfileExists(name) });
  }
  for (const name of ["cats", " spaced channel ", "missing", "CATS", ""]) {
    t.assert.snapshot({ name, exists: await repository.channelExists(name) });
  }
});

test("a request-scoped write is visible to the subsequent managed existence read", async () => {
  await runWithRequestBookmarks(async () => {
    assert.ok(getRequestBookmarkManager());
    await driver.executeQuery("CREATE (:User {username: $username})", { username: "new-user" });
    const repository = createContributionTargetRepository(driver);
    assert.equal(await repository.userExists("new-user"), true);
    assert.equal(
      (await driver.executeQuery(
        "MATCH (u:User {username: $username}) RETURN u.username",
        { username: "new-user" }
      )).records.length,
      1
    );
  });
});

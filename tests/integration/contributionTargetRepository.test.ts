import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { createContributionTargetRepository } from "../../services/persistence/contributionTargetRepository.js";
import {
  installRequestScopedBookmarks,
  runWithRequestBookmarks,
  getRequestBookmarkManager,
} from "../../services/requestScopedBookmarks.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];

before(async () => {
  driver = installRequestScopedBookmarks(await startNeo4j());
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const neoSchema = new Neo4jGraphQL({
    typeDefs,
    driver,
    resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  initializeOgmFromExistingSchema(ogm, neoSchema, await neoSchema.getSchema());
}, { timeout: 240_000 });

beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());

// Compare with the exact pre-migration selections, using the production shared
// schema rather than OGM's standalone schema that strips authorization.
test("contribution targets match production OGM existence for all target kinds", async () => {
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
    const old = await ogm.model("User").find({
      where: { username: name }, selectionSet: "{ username }",
    });
    assert.equal(await repository.userExists(name), old.length > 0, name);
  }
  for (const name of ["Mod One", " spaced mod ", "missing", "mod one", ""]) {
    const old = await ogm.model("ModerationProfile").find({
      where: { displayName: name }, selectionSet: "{ displayName }",
    });
    assert.equal(await repository.moderationProfileExists(name), old.length > 0, name);
  }
  for (const name of ["cats", " spaced channel ", "missing", "CATS", ""]) {
    const old = await ogm.model("Channel").find({
      where: { uniqueName: name }, selectionSet: "{ uniqueName }",
    });
    assert.equal(await repository.channelExists(name), old.length > 0, name);
  }
});

test("a request-scoped write is visible to the subsequent managed existence read", async () => {
  await runWithRequestBookmarks(async () => {
    assert.ok(getRequestBookmarkManager());
    await driver.executeQuery("CREATE (:User {username: $username})", { username: "new-user" });
    const repository = createContributionTargetRepository(driver);
    assert.equal(await repository.userExists("new-user"), true);
    assert.equal((await ogm.model("User").find({
      where: { username: "new-user" }, selectionSet: "{ username }",
    })).length, 1);
  });
});

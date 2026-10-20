import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver, SessionConfig } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";
import typeDefs from "../../typeDefs.js";
import { SortDirection } from "../../ogm_types.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import {
  executeGeneratedOperation,
  registerGeneratedSchema,
} from "../../services/persistence/generatedSchemaOperations.js";
import { installDefaultNeo4jDatabase } from "../../services/neo4jDatabase.js";
import {
  getRequestBookmarkManager,
  installRequestScopedBookmarks,
  runWithRequestBookmarks,
} from "../../services/requestScopedBookmarks.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
const sessions: SessionConfig[] = [];

before(async () => {
  driver = await startNeo4j();
  const session = driver.session.bind(driver);
  driver.session = (config?: SessionConfig) => {
    sessions.push(config ?? {});
    return session(config);
  };
  installDefaultNeo4jDatabase(driver, "neo4j");
  installRequestScopedBookmarks(driver);
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const neoSchema = new Neo4jGraphQL({
    typeDefs,
    driver,
    resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  // Exactly the production order: both internal APIs receive the executable
  // schema before outer authorization/middleware is applied.
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
  initializeOgmFromExistingSchema(ogm, neoSchema, schema);
}, { timeout: 240_000 });

beforeEach(async () => {
  await resetDatabase(driver);
  sessions.length = 0;
});
after(async () => stopNeo4j());

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const USER_SNAPSHOT = `query ContributionUserSnapshot($where: UserWhere) {
  users(where: $where) { username }
}`;

test("internal named reads preserve context-free production filtering and selected fields", async () => {
  await driver.executeQuery(`
    CREATE (:Discussion {id: 'visible', title: 'Visible'})
    CREATE (:Discussion {id: 'restricted', title: 'Restricted', hasSensitiveContent: true})
  `);
  const old = await ogm.model("Discussion").find({ selectionSet: "{ id title }" });
  const data = await executeGeneratedOperation<{ discussions: unknown[] }>(driver,
    "query NotificationDiscussionSnapshot { discussions { id title } }",
    // Neither an extra variable nor an ambient request bookmark grants an
    // internal snapshot the outer caller's sensitive-content claim.
    { jwt: { mayAccessSensitiveContent: true } }
  );
  assert.deepEqual(plain(data.discussions), plain(old));
  assert.deepEqual(plain(data.discussions), [{ id: "visible", title: "Visible" }]);
});

test("operation-owned selections retain generated default limits and GraphQL variable defaults", async () => {
  await driver.executeQuery(`
    UNWIND range(1, 30) AS ordinal
    CREATE (:User {username: 'user-' + toString(ordinal)})
  `);
  const old = await ogm.model("User").find({ selectionSet: "{ username }" });
  const data = await executeGeneratedOperation<{ users: unknown[] }>(driver, USER_SNAPSHOT, {});
  assert.equal(old.length, 25);
  assert.deepEqual(plain(data.users), plain(old));

  const selected = await executeGeneratedOperation<{ users: unknown[] }>(driver,
    `query FirstUsers($options: UserOptions = {limit: 2, sort: [{username: ASC}]}) {
      users(options: $options) { username }
    }`, {}
  );
  const oldSelected = await ogm.model("User").find({
    options: { limit: 2, sort: [{ username: SortDirection.Asc }] },
    selectionSet: "{ username }",
  });
  assert.deepEqual(plain(selected.users), plain(oldSelected));
  assert.equal(selected.users.length, 2);
});

const errorMessage = async (work: () => Promise<unknown>): Promise<string> => {
  try {
    await work();
    assert.fail("expected GraphQL execution to reject");
  } catch (error) {
    assert.equal((error as Error).constructor, Error);
    return (error as Error).message;
  }
};

test("validation/coercion fail before database access and expose the same first error as OGM", async () => {
  const where = { username: 42 };
  const oldCoercion = await errorMessage(() => ogm.model("User").find({
    where: where as never, selectionSet: "{ username }",
  }));
  const newCoercion = await errorMessage(() => executeGeneratedOperation(driver, USER_SNAPSHOT, { where }));
  assert.equal(newCoercion, oldCoercion);
  assert.match(newCoercion, /String cannot represent a non string value/);

  const oldSelection = await errorMessage(() => ogm.model("User").find({
    selectionSet: "{ missingFirst missingSecond }",
  }));
  const newSelection = await errorMessage(() => executeGeneratedOperation(driver,
    "query InvalidSnapshot { users { missingFirst missingSecond } }", {}
  ));
  assert.equal(newSelection, oldSelection);
  assert.match(newSelection, /missingFirst/);
  assert.doesNotMatch(newSelection, /missingSecond/);
  assert.equal(sessions.length, 0);
});

test("named reads retain OGM READ routing, configured database and request bookmarks after a write", async () => {
  await runWithRequestBookmarks(async () => {
    const bookmarkManager = getRequestBookmarkManager();
    assert.ok(bookmarkManager);
    await driver.executeQuery("CREATE (:User {username: 'new-user'})");
    sessions.length = 0;
    const old = await ogm.model("User").find({
      where: { username: "new-user" }, selectionSet: "{ username }",
    });
    const oldSessions = sessions.splice(0);
    const result = await executeGeneratedOperation<{ users: unknown[] }>(driver, USER_SNAPSHOT, {
      where: { username: "new-user" },
    });
    assert.deepEqual(plain(result.users), plain(old));
    assert.deepEqual(plain(result.users), [{ username: "new-user" }]);
    assert.equal(oldSessions.length, 1);
    assert.equal(sessions.length, 1);
    for (const config of [...oldSessions, ...sessions]) {
      assert.equal(config.defaultAccessMode, "READ");
      assert.equal(config.database, "neo4j");
      assert.equal(config.bookmarkManager, bookmarkManager);
    }
  });
});

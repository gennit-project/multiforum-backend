import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import neo4j, { type Driver } from "neo4j-driver";
import {
  coreSchemaConstraints,
  ensureCoreSchemaConstraints,
} from "../../services/coreSchemaConstraints.js";

let container: StartedNeo4jContainer;
let driver: Driver;

before(async () => {
  // Keep this schema test isolated: its persistent constraints would otherwise
  // leak into integration files that share a reusable container.
  container = await new Neo4jContainer("neo4j:5-community").start();
  driver = neo4j.driver(
    container.getBoltUri(),
    neo4j.auth.basic(container.getUsername(), container.getPassword())
  );
  await driver.getServerInfo();
  await ensureCoreSchemaConstraints(driver, "community");
  await ensureCoreSchemaConstraints(driver, "community");
}, { timeout: 240_000 });

after(async () => {
  await driver?.close();
  await container?.stop();
});

beforeEach(async () => {
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
  } finally {
    await session.close();
  }
});

const run = async (
  query: string,
  parameters: Record<string, unknown> = {}
) => {
  const session = driver.session();
  try {
    return await session.run(query, parameters);
  } finally {
    await session.close();
  }
};

const rejectsDuplicate = async (
  query: string,
  parameters: Record<string, unknown> = {}
) => {
  await assert.rejects(
    () => run(query, parameters),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "Neo.ClientError.Schema.ConstraintValidationFailed"
  );
};

test("Community provisions every core constraint idempotently with online indexes", async () => {
  const names: string[] = coreSchemaConstraints.map(({ name }) => name).sort();
  const constraints = await run(
    "SHOW CONSTRAINTS YIELD name, type RETURN name, type ORDER BY name"
  );
  const coreConstraints = constraints.records
    .map((record) => ({
      name: record.get("name") as string,
      type: record.get("type") as string,
    }))
    .filter(({ name }) => names.includes(name));
  assert.deepEqual(coreConstraints.map(({ name }) => name), names);
  assert.equal(
    coreConstraints.every(({ type }) => type === "UNIQUENESS"),
    true
  );

  const indexes = await run(
    "SHOW INDEXES YIELD name, state WHERE name IN $names RETURN name, state",
    { names }
  );
  assert.deepEqual(
    indexes.records
      .map((record) => ({
        name: record.get("name") as string,
        state: record.get("state") as string,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    names.map((name) => ({ name, state: "ONLINE" }))
  );
});

test("Community rejects duplicate discussion and event connector identities", async () => {
  await run(`
    CREATE (:DiscussionChannel {
      id: 'discussion-channel-1', discussionId: 'discussion-1', channelUniqueName: 'cats'
    })
    CREATE (:EventChannel {
      id: 'event-channel-1', eventId: 'event-1', channelUniqueName: 'cats'
    })
  `);
  await rejectsDuplicate(`
    CREATE (:DiscussionChannel {
      id: 'discussion-channel-2', discussionId: 'discussion-1', channelUniqueName: 'cats'
    })
  `);
  await rejectsDuplicate(`
    CREATE (:EventChannel {
      id: 'event-channel-2', eventId: 'event-1', channelUniqueName: 'cats'
    })
  `);
});

test("Community rejects duplicate channel issue numbers", async () => {
  await run(`
    CREATE (:Issue {id: 'issue-1', channelUniqueName: 'cats', issueNumber: 1})
  `);
  await rejectsDuplicate(`
    CREATE (:Issue {id: 'issue-2', channelUniqueName: 'cats', issueNumber: 1})
  `);
});

test("Community rejects duplicate channel issue targets", async () => {
  const cases = [
    ["discussion", "relatedDiscussionId", "discussion-1"],
    ["event", "relatedEventId", "event-1"],
    ["comment", "relatedCommentId", "comment-1"],
  ] as const;
  for (const [scope, property, targetId] of cases) {
    await run(`
      CREATE (:Issue {
        id: $firstId, channelUniqueName: $channel, issueNumber: 1,
        ${property}: $targetId
      })
    `, { firstId: `${scope}-issue-1`, channel: scope, targetId });
    await rejectsDuplicate(`
      CREATE (:Issue {
        id: $secondId, channelUniqueName: $channel, issueNumber: 2,
        ${property}: $targetId
      })
    `, { secondId: `${scope}-issue-2`, channel: scope, targetId });
  }

  await run(`
    CREATE (:Issue {
      id: 'wiki-issue-1', channelUniqueName: 'wiki', issueNumber: 1,
      relatedWikiPageId: 'wiki-1', relatedWikiRevisionId: 'revision-1'
    })
  `);
  await rejectsDuplicate(`
    CREATE (:Issue {
      id: 'wiki-issue-2', channelUniqueName: 'wiki', issueNumber: 2,
      relatedWikiPageId: 'wiki-1', relatedWikiRevisionId: 'revision-1'
    })
  `);
});

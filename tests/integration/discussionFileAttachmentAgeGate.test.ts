import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import type { GraphQLResolveInfo } from "graphql";
import neo4j, { type Driver } from "neo4j-driver";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import typeDefinitions from "../../typeDefs.js";
import getCustomResolvers from "../../customResolvers.js";
import { getAgeGateStatements } from "../../services/ageGate/definitions.js";
import { installAgeGateReconcile } from "../../services/ageGate/reconcile.js";
import type { GraphQLContext } from "../../types/context.js";

// Attaching an existing file to a discussion is a relationship-only connect,
// which @neo4j/graphql doesn't stamp, so the reconcile step can't see it on its
// own. updateDiscussionWithChannelConnections must flag the file in the same
// transaction (docs/age-gate-materialization-design.md, step 4).

const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let container: StartedNeo4jContainer;
let driver: Driver;
let resolvers: ReturnType<typeof getCustomResolvers>["resolvers"];

before(async () => {
  let builder = new Neo4jContainer("neo4j:5-community").withApoc();
  if (REUSE) builder = builder.withReuse();
  container = await builder.start();
  driver = installAgeGateReconcile(
    neo4j.driver(
      container.getBoltUri(),
      neo4j.auth.basic(container.getUsername(), container.getPassword())
    ),
    getAgeGateStatements(typeDefinitions)
  );
  const custom = getCustomResolvers(driver);
  await custom.ogm.init();
  resolvers = custom.resolvers;
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  if (!REUSE) await container?.stop();
});

beforeEach(async () => {
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
    await session.run(`
      CREATE (:Discussion {id: 'sensitive', title: 't', createdAt: datetime(), hasSensitiveContent: true})
      CREATE (:Discussion {id: 'clear', title: 't', createdAt: datetime()})
      CREATE (:DownloadableFile {id: 'file', fileName: 'model.stl', kind: 'STL', url: 'https://x/model.stl'})
    `);
  } finally {
    await session.close();
  }
});

const attachFile = (discussionId: string) =>
  resolvers.Mutation.updateDiscussionWithChannelConnections(
    null,
    {
      where: { id: discussionId },
      discussionUpdateInput: {
        DownloadableFiles: [{ connect: [{ where: { node: { id: "file" } } }] }],
      },
      channelConnections: [],
      channelDisconnections: [],
    },
    { driver, req: { headers: {} } } as unknown as GraphQLContext,
    {} as GraphQLResolveInfo
  );

const fileRestricted = async (): Promise<boolean | null> => {
  const session = driver.session();
  try {
    const result = await session.run(
      "MATCH (f:DownloadableFile {id: 'file'}) RETURN f.ageGateRestricted AS restricted"
    );
    return (result.records[0]?.get("restricted") as boolean | null) ?? null;
  } finally {
    await session.close();
  }
};

test("attaching an existing file to a sensitive discussion restricts the file", async () => {
  await attachFile("sensitive");
  assert.equal(await fileRestricted(), true);
});

test("attaching an existing file to an unmarked discussion leaves it clear", async () => {
  await attachFile("clear");
  assert.notEqual(await fileRestricted(), true);
});

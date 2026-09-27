import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import jwt from "jsonwebtoken";
import neo4j, { type Driver } from "neo4j-driver";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import typeDefinitions from "../../typeDefs.js";
import getCustomResolvers from "../../customResolvers.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import ownershipCreateMiddleware from "../../middleware/ownershipCreateMiddleware.js";
import type { Ogm } from "../../types/context.js";

// Reproduces the production wiring in index.ts: the OGM reuses the executable
// schema that carries the custom resolvers, and middleware wraps only the
// schema served over HTTP. Under that wiring, a custom resolver that replaces a
// generated createX mutation and calls X.create() recursed into itself.

const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let container: StartedNeo4jContainer;
let driver: Driver;
let ogm: Ogm;
let httpSchema: GraphQLSchema;

before(async () => {
  let builder = new Neo4jContainer("neo4j:5-community").withApoc();
  if (REUSE) builder = builder.withReuse();
  container = await builder.start();
  process.env.E2E_MOCK_AUTH = "true";
  driver = neo4j.driver(
    container.getBoltUri(),
    neo4j.auth.basic(container.getUsername(), container.getPassword())
  );

  const custom = getCustomResolvers(driver);
  ogm = custom.ogm as Ogm;
  const neoSchema = new Neo4jGraphQL({
    typeDefs: typeDefinitions,
    driver,
    resolvers: custom.resolvers,
  });
  const schema = await neoSchema.getSchema();
  initializeOgmFromExistingSchema(ogm, neoSchema, schema);
  httpSchema = applyMiddleware(schema, ownershipCreateMiddleware);
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  if (!REUSE) await container?.stop();
});

beforeEach(async () => {
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
    await session.run("CREATE (:User {username: 'alice'}), (:User {username: 'mallory'})");
  } finally {
    await session.close();
  }
});

const aliceContext = () => ({
  driver,
  ogm,
  req: {
    headers: {
      authorization: `Bearer ${jwt.sign(
        { username: "alice", email: "alice@example.com" },
        "mock-signing-key"
      )}`,
    },
    body: {},
  },
});

const execute = async (source: string) => {
  const result = await graphql({ schema: httpSchema, source, contextValue: aliceContext() });
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return result.data as Record<string, any>;
};

const ownerOf = async (cypher: string): Promise<string | null> => {
  const session = driver.session();
  try {
    const result = await session.run(cypher);
    return (result.records[0]?.get("username") as string | undefined) ?? null;
  } finally {
    await session.close();
  }
};

test("createImageWithUploader creates the image instead of recursing through the OGM", async () => {
  const data = await execute(`mutation {
    createImageWithUploader(input: { url: "https://example.com/a.jpg" }) { id }
  }`);

  assert.equal(
    await ownerOf(
      `MATCH (:Image {id: '${data.createImageWithUploader.id}'})<-[:UPLOADED_IMAGE]-(u:User) RETURN u.username AS username`
    ),
    "alice"
  );
});

test("createCollections over HTTP forces the creator to the signed-in user", async () => {
  await execute(`mutation {
    createCollections(input: [{
      name: "Favorites", collectionType: DISCUSSIONS, visibility: PRIVATE,
      itemOrder: [], updatedAt: "2026-09-27T00:00:00.000Z",
      CreatedBy: { connect: { where: { node: { username: "mallory" } } } }
    }]) { collections { id } }
  }`);

  assert.equal(
    await ownerOf("MATCH (:Collection {name: 'Favorites'})-[:CREATED_BY]->(u:User) RETURN u.username AS username"),
    "alice"
  );
});

test("createAlbums over HTTP forces the owner to the signed-in user", async () => {
  await execute(`mutation {
    createAlbums(input: [{
      imageOrder: [],
      Owner: { connect: { where: { node: { username: "mallory" } } } }
    }]) { albums { id } }
  }`);

  assert.equal(
    await ownerOf("MATCH (:Album)<-[:HAS_ALBUM]-(u:User) RETURN u.username AS username"),
    "alice"
  );
});

test("server-side OGM creates reach the generated mutations", async () => {
  const response = await ogm.model("Album").create({
    input: [{ imageOrder: [], Owner: { connect: { where: { node: { username: "mallory" } } } } }],
  });

  assert.equal(response.albums.length, 1);
});

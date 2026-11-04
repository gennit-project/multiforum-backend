import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import getResolvers from "../helpers/getTestResolvers.js";
import setProfileImage from "../../customResolvers/mutations/setProfileImage.js";
import setChannelIcon from "../../customResolvers/mutations/setChannelIcon.js";
import createImage from "../../customResolvers/mutations/createImageWithUploader.js";
import type { ImageVariantGenerationResult } from "../../services/imageVariants.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createImageCreationRepository, createProfileImageRepository, createChannelIconRepository } from "../../services/persistence/imageWriteRepository.js";
import { denyImageExternalIo } from "../denyImageExternalIo.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver;
let schema: GraphQLSchema;
let guard: ReturnType<typeof denyImageExternalIo>;
let generated: ImageVariantGenerationResult;
let generationCalls: number;
let failGeneration: boolean;
const previousServerConfig = process.env.SERVER_CONFIG_NAME;
const variants = { avatar32: "https://img.test/32?x=1&y=two", avatar48: "https://img.test/48" };
const generateVariants = async () => {
  generationCalls++;
  if (failGeneration) throw new Error("fixture generation failure");
  return generated;
};
before(async () => {
  driver = await startNeo4j();
  process.env.SERVER_CONFIG_NAME = "variant-fixture";
  const app = getResolvers(driver).resolvers;
  const raw = await new Neo4jGraphQL({ driver, typeDefs, resolvers: {
    ...app,
    Mutation: {
      ...app.Mutation,
      setProfileImage: setProfileImage({ driver, generateVariants }),
      setChannelIcon: setChannelIcon({ driver, generateVariants }),
      createImageWithUploader: createImage({ driver, generateVariants }),
    },
  } }).getSchema();
  registerGeneratedSchema(driver, raw);
  schema = applyMiddleware(raw, permissions);
  guard = denyImageExternalIo();
}, { timeout: 240000 });
after(async () => {
  guard?.assertUnused();
  guard?.restore();
  await stopNeo4j();
  if (previousServerConfig === undefined) delete process.env.SERVER_CONFIG_NAME;
  else process.env.SERVER_CONFIG_NAME = previousServerConfig;
});
beforeEach(async () => {
  await resetDatabase(driver);
  generated = { variantUrls: variants, variantStorageObjectNames: {} };
  generationCalls = 0;
  failGeneration = false;
  await driver.executeQuery(`
    CREATE (:ServerConfig {serverName:'variant-fixture'})-[:HAS_DEFAULT_SERVER_ROLE]->(:ServerRole {canUploadFile:true})
    CREATE (u:User {username:'alice', profilePicURL:'old-profile'})
    CREATE (:User {username:'bob'})
    CREATE (c:Channel {uniqueName:'forum',channelIconURL:'old-icon'})
    CREATE (u)-[:ADMIN_OF_CHANNEL]->(c)
    CREATE (:UploadedFileAudit {storageBucket:'fixture',storageObjectName:'upload',
      storageUrl:'https://img.test/original',uploadedByUsername:'alice',uploadedAt:datetime()})
  `);
});
function execute(source: string, username: string | null = "alice") {
  return graphql({ schema, source, contextValue: {
    driver, req: { headers: {}, body: { query: source } },
    user: username ? { username, email: null, data: {}, email_verified: true } : undefined,
    mayAccessSensitiveContent: false,
  } });
}
const operations = {
  profile: 'mutation { result:setProfileImage(username:"alice",imageUrl:"https://img.test/original") { profilePicURL variantUrls avatar32Url avatar48Url } }',
  icon: 'mutation { result:setChannelIcon(channelUniqueName:"forum",imageUrl:"https://img.test/original") { channelIconURL variantUrls icon32Url icon48Url } }',
  image: 'mutation { result:createImageWithUploader(input:{url:"https://img.test/original",storageObjectName:"upload"}) { id variantUrls list80Url detail640Url Uploader {username} } }',
};
function data(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data));
}
async function auditClaim() {
  return (await driver.executeQuery("MATCH (a:UploadedFileAudit) RETURN a.claimedByType AS type")).records[0].get("type");
}
for (const kind of ["profile", "icon", "image"] as const) {
  test(`${kind}: nonempty generated variants persist and round-trip through GraphQL`, async () => {
    const expected = kind === "image"
      ? { list80: "https://img.test/list80", detail640: "https://img.test/detail640" }
      : variants;
    generated = { variantUrls: expected, variantStorageObjectNames: {} };
    const result = data(await execute(operations[kind])).result;
    assert.deepEqual(result.variantUrls, expected);
    if (kind === "profile") assert.equal(result.avatar32Url, variants.avatar32);
    if (kind === "icon") assert.equal(result.icon32Url, variants.avatar32);
    if (kind === "image") assert.equal(result.list80Url, generated.variantUrls.list80);
    assert.equal(generationCalls, 1);
    assert.equal(await auditClaim(), { profile: "UserProfileImage", icon: "ChannelIcon", image: "Image" }[kind]);
    const label = { profile: "User", icon: "Channel", image: "Image" }[kind];
    const stored = (await driver.executeQuery(`MATCH (n:${label}) WHERE n.variantUrls IS NOT NULL RETURN n.variantUrls AS value`)).records[0].get("value");
    assert.equal(typeof stored, "string");
    assert.deepEqual(JSON.parse(stored), expected);
    // Selecting ONLY the JSON field must work: no dependency on selecting scalar URLs.
    const read = { profile: '{users(where:{username:{eq:"alice"}}){v:variantUrls}}', icon: '{channels(where:{uniqueName:{eq:"forum"}}){v:variantUrls}}', image: '{images {v:variantUrls}}' }[kind];
    const rows = Object.values(data(await execute(read, null)))[0] as Array<{v: unknown}>;
    assert.deepEqual(rows[0].v, expected);
    if (kind === "image") assert.equal(result.Uploader.username, "alice");
  });
  test(`${kind}: empty generation succeeds without fabricated variants`, async () => {
    generated = { variantUrls: {}, variantStorageObjectNames: {} };
    assert.equal(data(await execute(operations[kind])).result.variantUrls, null);
    assert.notEqual(await auditClaim(), null);
  });
  test(`${kind}: generation failure preserves the existing fallback or rejection behavior`, async () => {
    failGeneration = true;
    const result = await execute(operations[kind]);
    if (kind === "image") {
      assert.equal(data(result).result.variantUrls, null);
      assert.equal(await auditClaim(), "Image");
      assert.equal(generationCalls, 1);
      return;
    }
    assert.match(result.errors?.[0].message ?? "", /fixture generation failure/);
    assert.equal(generationCalls, 1);
    assert.equal(await auditClaim(), null);
    const state = (await driver.executeQuery("MATCH (u:User {username:'alice'}),(c:Channel) RETURN u.profilePicURL AS profile,c.channelIconURL AS icon")).records[0].toObject();
    assert.deepEqual(state, { profile: "old-profile", icon: "old-icon" });
    assert.equal((await driver.executeQuery("MATCH (i:Image) RETURN count(i) AS count")).records[0].get("count").toNumber(), 0);
  });
  for (const actor of [null, "bob"]) {
    test(`${kind}: ${actor ?? "anonymous"} cannot use Alice's upload or mutate her targets`, async () => {
      const result = await execute(operations[kind], actor);
      assert.ok(result.errors?.length);
      assert.equal(generationCalls, 0);
      assert.equal(await auditClaim(), null);
    });
  }
}

for (const kind of ["profile", "icon", "image"] as const) {
  test(`${kind}: repository preserves empty/null maps and supports legacy scalar-only records`, async () => {
    const label = { profile: "User", icon: "Channel", image: "Image" }[kind];
    const scalar = { profile: "avatar32Url", icon: "icon32Url", image: "list80Url" }[kind];
    const key = kind === "image" ? "list80" : "avatar32";
    const write = async (value: unknown) => {
      if (kind === "profile") return createProfileImageRepository(driver).setProfileImage("alice", { variantUrls: { set: value } });
      if (kind === "icon") return createChannelIconRepository(driver).setChannelIcon("forum", { variantUrls: { set: value } });
      await driver.executeQuery("MATCH (i:Image) DETACH DELETE i");
      return createImageCreationRepository(driver).createImage({ variantUrls: value });
    };
    for (const value of [{}, null]) {
      await write(value);
      const rows = (await driver.executeQuery(`MATCH (n:${label}) WHERE ${kind === "profile" ? "n.username = 'alice'" : "true"} RETURN n.variantUrls AS value`)).records;
      assert.equal(rows[0].get("value"), value === null ? null : "{}");
      const read = { profile: '{users(where:{username:{eq:"alice"}}){variantUrls}}', icon: '{channels {variantUrls}}', image: '{images {variantUrls}}' }[kind];
      const projected = Object.values(data(await execute(read, null)))[0] as Array<{variantUrls: unknown}>;
      assert.equal(projected[0].variantUrls, null);
    }
    await driver.executeQuery(`MATCH (n:${label}) SET n.${scalar} = 'https://img.test/legacy'`);
    const read = { profile: '{users(where:{username:{eq:"alice"}}){variantUrls avatar32Url}}', icon: '{channels {variantUrls icon32Url}}', image: '{images {variantUrls list80Url}}' }[kind];
    const rows = Object.values(data(await execute(read, null)))[0] as Array<{variantUrls: unknown}>;
    assert.deepEqual(rows[0].variantUrls, { [key]: "https://img.test/legacy" });
  });
}

for (const kind of ["profile", "icon", "image"] as const) {
  test(`${kind}: an upload owned by someone else is rejected before generation`, async () => {
    await driver.executeQuery("MATCH (a:UploadedFileAudit) SET a.uploadedByUsername = 'bob'");
    const result = await execute(operations[kind]);
    assert.match(result.errors?.[0].message ?? "", /Upload metadata not found/);
    assert.equal(generationCalls, 0);
    assert.equal(await auditClaim(), null);
  });
  test(`${kind}: database failure does not claim upload or partially store variants`, async () => {
    const label = { profile: "User", icon: "Channel", image: "Image" }[kind];
    const property = { profile: "profilePicURL", icon: "channelIconURL", image: "storageObjectName" }[kind];
    const value = kind === "image" ? "upload" : "https://img.test/original";
    await driver.executeQuery(`CREATE CONSTRAINT variant_failure_fixture IF NOT EXISTS FOR (n:${label}) REQUIRE n.${property} IS UNIQUE`);
    try {
      await driver.executeQuery(`CREATE (:${label} {${property}:$value})`, { value });
      const result = await execute(operations[kind]);
      assert.ok(result.errors?.length, "database failure must not report success");
      assert.equal(generationCalls, 1);
      assert.equal(await auditClaim(), null);
      const count = (await driver.executeQuery("MATCH (n) WHERE n.variantUrls IS NOT NULL RETURN count(n) AS count")).records[0].get("count").toNumber();
      assert.equal(count, 0);
      const state = (await driver.executeQuery("MATCH (u:User {username:'alice'}),(c:Channel {uniqueName:'forum'}) RETURN u.profilePicURL AS profile,c.channelIconURL AS icon")).records[0].toObject();
      assert.deepEqual(state, { profile: "old-profile", icon: "old-icon" });
    } finally {
      await driver.executeQuery("DROP CONSTRAINT variant_failure_fixture IF EXISTS");
    }
  });
}

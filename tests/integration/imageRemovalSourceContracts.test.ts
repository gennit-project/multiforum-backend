import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import removeImage from "../../customResolvers/mutations/permanentlyRemoveImage.js";
import { createImageModerationRepository } from "../../services/persistence/imageModerationRepository.js";
import { startImageModEnv, stopImageModEnv, resetDb, run, seedModerator, mockToken, modContext, type ImageModEnv } from "./imageModerationHarness.js";

let env: ImageModEnv, schema: GraphQLSchema, secured: GraphQLSchema;
let fail: "read" | "write" | null = null;
before(async () => {
  env = await startImageModEnv();
  const repository = createImageModerationRepository(env.driver);
  schema = await new Neo4jGraphQL({ driver: env.driver, typeDefs, resolvers: {
    ...env.resolvers, Mutation: { ...env.resolvers.Mutation,
      permanentlyRemoveImage: removeImage({ driver: env.driver, repository: {
        ...repository,
        async findPermanentRemovalTarget(id) {
          if (fail === "read") throw new Error("image read unavailable");
          return repository.findPermanentRemovalTarget(id);
        },
        async updateModerationState(where, update) {
          if (fail === "write") throw new Error("image write unavailable");
          return repository.updateModerationState(where, update);
        },
      } }),
    },
  } }).getSchema();
  schema = applyMiddleware(schema, sourceIdentity);
  secured = applyMiddleware(schema, permissions);
}, { timeout: 240000 });
after(async () => stopImageModEnv());
beforeEach(async () => {
  await resetDb(); fail = null;
  await seedModerator({ username: "mod1", modDisplayName: "Mod One" });
  await run(`CREATE (img:Image {id:'img-1',url:'https://example.com/image.jpg',permanentlyRemoved:false,scanStatus:'PENDING'})
    CREATE (u:User {username:'uploader1'}) CREATE (u)-[:UPLOADED_IMAGE]->(img)`);
});
const execute = (fields = "id isOpen", imageId = "img-1", secure = false, username = "mod1") => graphql({
  schema: secure ? secured : schema,
  source: `mutation { permanentlyRemoveImage(imageId:"${imageId}",explanation:null) { ${fields} } }`,
  contextValue: username ? modContext(env, mockToken({ username, email: `${username}@e2e.test` })) : { driver: env.driver, req: { headers: {} } },
});
const removed = async () => (await run("MATCH(i:Image {id:'img-1'}) RETURN i.permanentlyRemoved AS removed"))[0].removed;

test("image removal serializes the guarded issue identity and close assignment, with server scope and both actions", async () => {
  const result = await execute(); assert.equal(result.errors, undefined);
  const row = result.data?.permanentlyRemoveImage as {id:string;isOpen:boolean};
  assert.ok(row.id); assert.equal(row.isOpen, false); assert.equal(await removed(), true);
  const issues = await run("MATCH(i:Issue)-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction) RETURN i.id AS id,i.channelUniqueName AS scope,collect(a.actionType) AS actions");
  assert.equal(issues.length, 1); assert.equal(issues[0].id, row.id); assert.equal(issues[0].scope, null);
  assert.deepEqual([...issues[0].actions].sort(), ["close", "permanent-removal"]);
  const repeat = await execute(); assert.match(repeat.errors?.[0].message ?? "", /already been permanently removed/);
});

test("image removal rejects missing targets before issue writes", async () => {
  assert.match((await execute("id isOpen", "missing")).errors?.[0].message ?? "", /Image not found/);
  assert.deepEqual(await run("MATCH(i:Issue) RETURN i.id AS id"), []); assert.equal(await removed(), false);
});

test("image removal shield rejects anonymous and non-moderator calls before writes", async () => {
  for (const username of ["", "uploader1"]) assert.ok((await execute("id isOpen", "img-1", true, username)).errors);
  assert.equal(await removed(), false); assert.deepEqual(await run("MATCH(i:Issue) RETURN i.id AS id"), []);
});

test("image removal preserves read failure and write-after-close failure semantics", async () => {
  fail = "read"; assert.match((await execute()).errors?.[0].message ?? "", /image read unavailable/);
  assert.deepEqual(await run("MATCH(i:Issue) RETURN i.id AS id"), []);
  fail = "write"; assert.match((await execute()).errors?.[0].message ?? "", /Error updating image/);
  assert.equal(await removed(), false);
  const issues = await run("MATCH(i:Issue) RETURN i.isOpen AS isOpen");
  assert.deepEqual(issues, [{isOpen:false}]);
});

for (const selectBody of [false, true]) test(`image removal leaves raw body serialization lazy (body selected: ${selectBody})`, async () => {
  await run("CREATE(:Issue {id:'existing',issueNumber:1,title:'Title',body:['invalid','String'],isOpen:true,flaggedServerRuleViolation:false,relatedImageId:'img-1'})");
  const result = await execute(selectBody ? "id isOpen body" : "id isOpen");
  if (selectBody) { assert.match(result.errors?.[0].message ?? "", /String cannot represent/); assert.deepEqual(result.errors?.[0].path, ["permanentlyRemoveImage", "body"]); }
  else { assert.equal(result.errors, undefined); assert.equal((result.data?.permanentlyRemoveImage as {id:string}).id, "existing"); }
  assert.equal(await removed(), true);
  assert.deepEqual(await run("MATCH(i:Issue) RETURN i.isOpen AS isOpen"), [{isOpen:false}]);
});

test('permanent removal retains native Issue field meaning under aliases',async()=>{
 const result=await execute('id title:id');assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const row=JSON.parse(JSON.stringify(result.data)).permanentlyRemoveImage;assert.equal(row.title,row.id);
});

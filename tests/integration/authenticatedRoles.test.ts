// Authenticated-role e2e: the highest-fidelity authorization test. It runs a
// real admin-gated mutation through the real schema + graphql-shield, against a
// live Neo4j, as three different callers:
//
//   1. unauthenticated        -> blocked by isAuthenticated (notAuthenticated)
//   2. authenticated non-admin -> passes isAuthenticated, blocked by isAdmin
//   3. authenticated admin     -> passes both; the resolver actually runs
//
// Case 2 is the one pure unit tests and the offline auth tests cannot reach:
// it proves the difference between "not logged in" and "logged in but not
// allowed" is wired correctly.
//
// Auth uses the app's built-in mock-auth seam (E2E_MOCK_AUTH=true), where a
// token is any JWT carrying username/email claims (decoded, not verified), and
// admin status is granted via the CYPRESS_ADMIN_TEST_EMAIL match.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { ERROR_MESSAGES } from "../../rules/errorMessages.js";

const ADMIN_EMAIL = "admin@e2e.test";
const SERVER_CONFIG_NAME = "E2ETestServer";
const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let container: StartedNeo4jContainer;
let schema: GraphQLSchema;
let driver: Driver;

before(async () => {
  // APOC is required: the OGM queries the permission rules run (suspension
  // lookups) call apoc.date.convertFormat.
  let builder = new Neo4jContainer("neo4j:5-community").withApoc();
  if (REUSE) builder = builder.withReuse();
  container = await builder.start();

  // The schema helper builds its driver from these, so set them before import.
  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  process.env.E2E_MOCK_AUTH = "true";
  process.env.CYPRESS_ADMIN_TEST_EMAIL = ADMIN_EMAIL;
  process.env.SERVER_CONFIG_NAME = SERVER_CONFIG_NAME;

  const { buildPermissionedSchema } = await import(
    "../helpers/buildPermissionedSchema.js"
  );
  ({ schema, driver } = await buildPermissionedSchema());

  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
    await session.run("CREATE (:User { username: 'adminuser' })");
    await session.run("CREATE (:User { username: 'normaluser' })");
    await session.run("CREATE (:ServerConfig { serverName: $name })", {
      name: SERVER_CONFIG_NAME,
    });
  } finally {
    await session.close();
  }

  // Provision the default roles so a non-admin resolves the real
  // DefaultServerRole (which lacks the admin capabilities) — exercising the
  // post-migration permission path that the capability checks rely on.
  const { provisionServerDefaults } = await import(
    "../../seedData/provisionServerDefaults.js"
  );
  const { createServerDefaultsRepository } = await import(
    "../../services/persistence/serverDefaultsRepository.js"
  );
  await provisionServerDefaults({
    repository: createServerDefaultsRepository(driver),
    serverName: SERVER_CONFIG_NAME,
  });
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  if (!REUSE) await container?.stop();
});

const mockToken = (claims: Record<string, unknown>) =>
  `Bearer ${jwt.sign(claims, "mock-signing-key")}`;

// deleteServerConfigs is gated `and(isAuthenticated, canManageServerSettings)`.
// The non-matching
// where clause makes the admit-path resolution a harmless no-op (deletes
// nothing) so the test is non-destructive.
const execDeleteServerConfigs = (authorization?: string) =>
  graphql({
    schema,
    source: `mutation {
      deleteServerConfigs(where: { serverName: { eq: "does-not-exist-xyz" } }) {
        nodesDeleted
      }
    }`,
    contextValue: {
      driver,
      req: {
        headers: authorization ? { authorization } : {},
        body: {},
        isMutation: true,
      },
    },
  });

test("unauthenticated request is blocked by isAuthenticated", async () => {
  const result = await execDeleteServerConfigs(undefined);
  assert.ok(result.errors && result.errors.length > 0);
  assert.equal(
    result.errors[0].message,
    ERROR_MESSAGES.channel.notAuthenticated
  );
  assert.equal(result.data, null);
});

test("authenticated non-admin is blocked by the capability check (not by isAuthenticated)", async () => {
  const result = await execDeleteServerConfigs(
    mockToken({ username: "normaluser", email: "normal@e2e.test" })
  );
  assert.ok(result.errors && result.errors.length > 0);
  // Denied by authorization (canManageServerSettings), NOT authentication — the
  // non-admin resolves DefaultServerRole, which lacks the capability.
  assert.equal(
    result.errors[0].message,
    ERROR_MESSAGES.server.noServerPermission
  );
  assert.notEqual(
    result.errors[0].message,
    ERROR_MESSAGES.channel.notAuthenticated
  );
  assert.equal(result.data, null);
});

test("authenticated admin passes the shield and the resolver runs", async () => {
  const result = await execDeleteServerConfigs(
    mockToken({ username: "adminuser", email: ADMIN_EMAIL })
  );
  assert.equal(
    result.errors,
    undefined,
    `admin should not be blocked, got: ${JSON.stringify(result.errors)}`
  );
  const data = result.data as
    | { deleteServerConfigs?: { nodesDeleted?: number } }
    | null
    | undefined;
  assert.equal(data?.deleteServerConfigs?.nodesDeleted, 0);
});

// --- Resource-ownership gate: deleteComments = and(isAuthenticated, or(isAdmin, isCommentAuthor)) ---
//
// The ownership analogue of the admin test above. isCommentAuthor reads the
// comment's CommentAuthor from the DB and compares it to the caller, so this
// exercises the full path: shield rule -> live OGM lookup -> allow/deny. Each
// test seeds its own comment so the admit case (which actually deletes) cannot
// affect the deny cases regardless of run order.

const seedComment = async (id: string, authorUsername: string) => {
  const session = driver.session();
  try {
    await session.run(
      `MATCH (u:User { username: $authorUsername })
       CREATE (c:Comment { id: $id, text: 'hello', isRootComment: true, createdAt: datetime() })
       CREATE (u)-[:AUTHORED_COMMENT]->(c)`,
      { id, authorUsername }
    );
  } finally {
    await session.close();
  }
};

const countComment = async (id: string): Promise<number> => {
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (c:Comment { id: $id }) RETURN count(c) AS n`,
      { id }
    );
    return res.records[0].get("n").toNumber();
  } finally {
    await session.close();
  }
};

const execDeleteComments = (id: string, authorization?: string) =>
  graphql({
    schema,
    source: `mutation ($id: ID!) {
      deleteComments(where: { id: { eq: $id } }) { nodesDeleted }
    }`,
    variableValues: { id },
    contextValue: {
      driver,
      req: {
        headers: authorization ? { authorization } : {},
        body: {},
        isMutation: true,
      },
    },
  });

test("deleteComments: unauthenticated request is blocked by isAuthenticated", async () => {
  await seedComment("c-unauth", "normaluser");
  const result = await execDeleteComments("c-unauth");
  assert.ok(result.errors && result.errors.length > 0);
  assert.equal(result.errors[0].message, ERROR_MESSAGES.channel.notAuthenticated);
  assert.equal(await countComment("c-unauth"), 1, "comment must survive a denied delete");
});

test("deleteComments: authenticated non-author non-admin is blocked by isCommentAuthor", async () => {
  await seedComment("c-other", "normaluser");
  const result = await execDeleteComments(
    "c-other",
    mockToken({ username: "adminuser", email: "not-admin-here@e2e.test" })
  );
  // adminuser is not an admin here (email doesn't match) and is not the author,
  // so both branches of the or() fail -> shield's default deny.
  assert.ok(result.errors && result.errors.length > 0);
  assert.match(result.errors[0].message, /Not Authoris/i);
  assert.notEqual(result.errors[0].message, ERROR_MESSAGES.channel.notAuthenticated);
  assert.equal(await countComment("c-other"), 1, "comment must survive a denied delete");
});

test("deleteComments: the comment author passes isCommentAuthor and the resolver deletes it", async () => {
  await seedComment("c-own", "normaluser");
  const result = await execDeleteComments(
    "c-own",
    mockToken({ username: "normaluser", email: "normal@e2e.test" })
  );
  assert.equal(
    result.errors,
    undefined,
    `author should not be blocked, got: ${JSON.stringify(result.errors)}`
  );
  const data = result.data as { deleteComments?: { nodesDeleted?: number } } | null;
  assert.equal(data?.deleteComments?.nodesDeleted, 1);
  assert.equal(await countComment("c-own"), 0, "the author's comment should be deleted");
});

// --- Account-owner + input-validation gate:
//     updateUsers = and(isAuthenticated, updateUserInputIsValid, or(isAccountOwner, isAdmin))
//
// Adds two paths the comment gate above doesn't reach:
//   - isAccountOwner DENIES BY THROWING (not by returning false), exercising
//     shield's or() over a throwing rule.
//   - an input-validation gate (updateUserInputIsValid) that can deny an
//     otherwise-authorized owner purely on bad input.

const readBio = async (username: string): Promise<string | null> => {
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (u:User { username: $username }) RETURN u.bio AS bio`,
      { username }
    );
    return res.records[0]?.get("bio") ?? null;
  } finally {
    await session.close();
  }
};

const execUpdateUserBio = (username: string, bio: string, authorization?: string) =>
  graphql({
    schema,
    source: `mutation ($username: String!, $bio: String!) {
      updateUsers(where: { username: { eq: $username } }, update: { bio: { set: $bio } }) {
        users { username bio }
      }
    }`,
    variableValues: { username, bio },
    contextValue: {
      driver,
      req: {
        headers: authorization ? { authorization } : {},
        body: {},
        isMutation: true,
      },
    },
  });

test("updateUsers: authenticated non-owner is blocked by isAccountOwner (throwing branch of or())", async () => {
  const result = await execUpdateUserBio(
    "normaluser",
    "hacked bio",
    mockToken({ username: "adminuser", email: "not-admin-here@e2e.test" })
  );
  assert.ok(result.errors && result.errors.length > 0);
  assert.notEqual(result.errors[0].message, ERROR_MESSAGES.channel.notAuthenticated);
  assert.notEqual(await readBio("normaluser"), "hacked bio", "non-owner must not change another user's bio");
});

test("updateUsers: the account owner passes and the resolver updates the bio", async () => {
  const result = await execUpdateUserBio(
    "normaluser",
    "my new bio",
    mockToken({ username: "normaluser", email: "normal@e2e.test" })
  );
  assert.equal(
    result.errors,
    undefined,
    `owner should not be blocked, got: ${JSON.stringify(result.errors)}`
  );
  assert.equal(await readBio("normaluser"), "my new bio");
});

test("updateUsers: an over-length bio is blocked by updateUserInputIsValid even for the owner", async () => {
  const longBio = "x".repeat(501); // MAX_CHARS_IN_USER_BIO is 500
  const result = await execUpdateUserBio(
    "normaluser",
    longBio,
    mockToken({ username: "normaluser", email: "normal@e2e.test" })
  );
  assert.ok(result.errors && result.errors.length > 0);
  assert.match(result.errors[0].message, /bio cannot exceed/i);
  assert.notEqual(await readBio("normaluser"), longBio, "invalid bio must not be persisted");
});

test('nullable persisted membership identities do not grant an authenticated user server permissions',async()=>{
 await driver.executeQuery(`MATCH(s:ServerConfig{serverName:$name})
  CREATE(u:User{fixture:'nullable-admin'}),(m:ModerationProfile{fixture:'nullable-mod'})
  CREATE(u)-[:ADMIN_OF_SERVER]->(s),(u)-[:SUPER_ADMIN_OF_SERVER]->(s),(m)-[:MODERATOR_OF_SERVER]->(s)`,{name:SERVER_CONFIG_NAME});
 try{
  const {createPermissionServerConfigRepository}=await import('../../services/persistence/permissionServerConfigRepository.js');
  const snapshot=await createPermissionServerConfigRepository(driver).findByName(SERVER_CONFIG_NAME);
  assert.ok(snapshot?.Admins.some(member=>member.username===null));
  assert.ok(snapshot?.Moderators.some(member=>member.displayName===null));
  const result=await execDeleteServerConfigs(mockToken({username:'normaluser',email:'normal@e2e.test'}));
  assert.equal(result.errors?.[0].message,ERROR_MESSAGES.server.noServerPermission);
  assert.equal(result.data,null);
 }finally{await driver.executeQuery("MATCH(n) WHERE n.fixture IN ['nullable-admin','nullable-mod'] DETACH DELETE n");}
});

test('native channel capability values grant discussion creation only for the Boolean true',async()=>{
 const name='role-capability-fixture',title='role-capability-contract-discussion';
 await driver.executeQuery("CREATE(c:Channel{uniqueName:$name,createdAt:datetime(),fixture:'role-capability'}),(r:ChannelRole{fixture:'role-capability'}) CREATE(c)-[:HAS_DEFAULT_CHANNEL_ROLE]->(r)",{name});
 try{
  for(const capability of ['true',1,false,true]){
   await driver.executeQuery("MATCH(r:ChannelRole{fixture:'role-capability'}) SET r.canCreateDiscussion=$capability",{capability});
   const result=await graphql({schema,source:'mutation($input:[DiscussionCreateInputWithChannels!]!){createDiscussionWithChannelConnections(input:$input){id title}}',variableValues:{input:[{discussionCreateInput:{title},channelConnections:[name]}]},contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test',email_verified:true})},body:{},isMutation:true}}});
   if(capability===true){assert.equal(result.errors,undefined);assert.ok(result.data?.createDiscussionWithChannelConnections);}
   else{assert.equal(result.errors?.[0].message,ERROR_MESSAGES.channel.noChannelPermission);assert.equal(result.data,null);}
   const count=(await driver.executeQuery('MATCH(d:Discussion{title:$title}) RETURN count(d) AS count',{title})).records[0].get('count').toNumber();
   assert.equal(count,capability===true?1:0);
  }
 }finally{
  await driver.executeQuery('MATCH(d:Discussion{title:$title}) DETACH DELETE d',{title});
  await driver.executeQuery('MATCH(dc:DiscussionChannel{channelUniqueName:$name}) DETACH DELETE dc',{name});
  await driver.executeQuery("MATCH(n) WHERE n.fixture='role-capability' DETACH DELETE n");
 }
});

test("native server capability values permit a management mutation only for Boolean true", async () => {
  const before = await driver.executeQuery(
    "MATCH(s:ServerConfig{serverName:$name})-[:HAS_DEFAULT_SERVER_ROLE]->(r:ServerRole) RETURN r.canManageServerSettings AS capability",
    { name: SERVER_CONFIG_NAME }
  );
  const previous = before.records[0].get("capability");
  try {
    for (const capability of ["true", 1, false, null, true]) {
      await driver.executeQuery(
        "MATCH(s:ServerConfig{serverName:$name})-[:HAS_DEFAULT_SERVER_ROLE]->(r:ServerRole) SET r.canManageServerSettings=$capability",
        { name: SERVER_CONFIG_NAME, capability }
      );
      const result = await execDeleteServerConfigs(
        mockToken({ username: "normaluser", email: "normal@e2e.test" })
      );
      if (capability === true) {
        assert.equal(result.errors, undefined);
        assert.ok(result.data?.deleteServerConfigs);
      } else {
        assert.equal(result.errors?.[0].message, ERROR_MESSAGES.server.noServerPermission);
        assert.equal(result.data, null);
      }
    }
  } finally {
    await driver.executeQuery(
      "MATCH(s:ServerConfig{serverName:$name})-[:HAS_DEFAULT_SERVER_ROLE]->(r:ServerRole) SET r.canManageServerSettings=$capability",
      { name: SERVER_CONFIG_NAME, capability: previous }
    );
  }
});

test("native server suspension leaves stay untrusted through cached permission enforcement", async () => {
  const roleResult = await driver.executeQuery("MATCH(s:ServerConfig{serverName:$name})-[:HAS_DEFAULT_SERVER_ROLE]->(r:ServerRole) RETURN r.canManageServerSettings AS previous", {name:SERVER_CONFIG_NAME});
  const previous = roleResult.records[0].get("previous");
  await driver.executeQuery("MATCH(s:ServerConfig{serverName:$name})-[:HAS_DEFAULT_SERVER_ROLE]->(r:ServerRole) SET r.canManageServerSettings=true", {name:SERVER_CONFIG_NAME});
  await driver.executeQuery(`MATCH(s:ServerConfig{serverName:$name})
    CREATE(x:Suspension{id:123,username:'normaluser',suspendedUntil:datetime('2000-01-01T00:00:00Z'),suspendedIndefinitely:'false'}),
      (i:Issue{id:789,issueNumber:'9'})
    CREATE(s)-[:SUSPENDED_AS_USER]->(x),(x)-[:HAS_CONTEXT]->(i)`, { name: SERVER_CONFIG_NAME });
  try {
    const { getActiveServerSuspension } = await import("../../rules/permission/getActiveServerSuspension.js");
    const result = await getActiveServerSuspension({ context: {driver}, username:"normaluser" });
    assert.equal(result.isSuspended, true, "retain existing truthiness of a stored indefinite flag");
    assert.equal(result.activeSuspension?.id, 123);
    assert.equal(result.activeSuspension?.suspendedIndefinitely, "false");
    assert.equal(typeof result.activeSuspension?.suspendedUntil, "string");
    assert.equal(result.relatedIssueId, 789);
    assert.equal(result.relatedIssueNumber, "9");
    const { createPermissionServerConfigRepository } = await import("../../services/persistence/permissionServerConfigRepository.js");
    const configuration = await createPermissionServerConfigRepository(driver).findByName(SERVER_CONFIG_NAME);
    assert.equal(configuration?.SuspendedUsers[0].id, 123);
    assert.equal(configuration?.SuspendedUsers[0].suspendedIndefinitely, "false");
    assert.deepEqual(configuration?.SuspendedUsers[0].RelatedIssue, {id:789,issueNumber:"9"});
    assert.equal(result.expiredUserSuspensions.length, 0);
    const response = await execDeleteServerConfigs(mockToken({username:"normaluser",email:"normal@e2e.test"}));
    assert.equal(response.errors?.[0].message, ERROR_MESSAGES.server.noServerPermission);
    assert.equal(response.data, null);
  } finally {
    await driver.executeQuery("MATCH(s:ServerConfig{serverName:$name})-[:HAS_DEFAULT_SERVER_ROLE]->(r:ServerRole) SET r.canManageServerSettings=$previous", {name:SERVER_CONFIG_NAME,previous});
    await driver.executeQuery("MATCH(x:Suspension{id:123}) DETACH DELETE x");
    await driver.executeQuery("MATCH(i:Issue{id:789}) DETACH DELETE i");
  }
});

test("account ownership is rechecked for each mutation alias", async () => {
  const beforeOther = await readBio("adminuser");
  const result = await graphql({
    schema,
    source: `mutation {
      allowed: updateUsers(where: {username: {eq: "normaluser"}}, update: {bio: {set: "owner alias update"}}) { users { username } }
      denied: updateUsers(where: {username: {eq: "adminuser"}}, update: {bio: {set: "other alias update"}}) { users { username } }
    }`,
    contextValue: { driver, req: { headers: { authorization: mockToken({username: "normaluser", email: "normal@e2e.test"}) }, body: {}, isMutation: true } },
  });
  assert.ok(result.errors?.some(error => error.path?.[0] === "denied"));
  assert.equal(await readBio("normaluser"), "owner alias update");
  assert.equal(await readBio("adminuser"), beforeOther);
});

for (const order of ["ASC", "DESC"]) {
  test(`account ownership isolates private child fields in ${order} order`, async () => {
    const session = driver.session();
    try {
      await session.run(`MATCH (u:User) WHERE u.username IN ['normaluser', 'adminuser']
        MERGE (e:Email {address: u.username + '@private.test'}) MERGE (e)-[:HAS_EMAIL]->(u)`);
    } finally { await session.close(); }
    const result = await graphql({
      schema,
      source: `query { users(where: {username: {in: ["normaluser", "adminuser"]}}, sort: [{username: ${order}}]) { username Email { address } } }`,
      contextValue: { driver, req: { headers: { authorization: mockToken({username: "normaluser", email: "normal@e2e.test"}) }, body: {} } },
    });
    assert.equal(result.errors?.length, 1, JSON.stringify(result));
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {users: (order === "ASC" ? [
      {username: "adminuser", Email: null}, {username: "normaluser", Email: {address: "normaluser@private.test"}},
    ] : [
      {username: "normaluser", Email: {address: "normaluser@private.test"}}, {username: "adminuser", Email: null},
    ])});
  });
}

const contentOwnershipCases = [
  {label: "Comment", mutation: "deleteComments", relation: "AUTHORED_COMMENT", incoming: true},
  {label: "Discussion", mutation: "deleteDiscussions", relation: "POSTED_DISCUSSION", incoming: true},
  {label: "Event", mutation: "deleteEvents", relation: "POSTED_BY", incoming: true},
  {label: "Issue", mutation: "deleteIssues", relation: "AUTHORED_ISSUE", incoming: false},
  {label: "Album", mutation: "deleteAlbums", relation: "HAS_ALBUM", incoming: true},
  {label: "Collection", mutation: "deleteCollections", relation: "CREATED_BY", incoming: false},
];
for (const {label, mutation, relation, incoming} of contentOwnershipCases) {
  test(`${mutation} checks ownership independently across aliases`, async () => {
    const ownId = `alias-own-${label}`;
    const otherId = `alias-other-${label}`;
    const session = driver.session();
    try {
      await session.run(`UNWIND [{id:$ownId, username:'normaluser'}, {id:$otherId, username:'adminuser'}] AS item
        MATCH (u:User {username:item.username}) CREATE (n:${label} {id:item.id})
        CREATE ${incoming ? `(u)-[:${relation}]->(n)` : `(n)-[:${relation}]->(u)`}`, {ownId, otherId});
      const result = await graphql({
        schema,
        source: `mutation($own: ID!, $other: ID!) {
          allowed: ${mutation}(where:{id:{eq:$own}}) {nodesDeleted}
          denied: ${mutation}(where:{id:{eq:$other}}) {nodesDeleted}
        }`,
        variableValues: {own: ownId, other: otherId},
        contextValue: {driver, req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}},
      });
      assert.ok(result.errors?.some(error => error.path?.[0] === 'denied'), JSON.stringify(result));
      const remaining = await session.run(`MATCH(n:${label}) WHERE n.id IN [$ownId,$otherId] RETURN n.id AS id`, {ownId, otherId});
      assert.deepEqual(remaining.records.map(record => record.get('id')), [otherId]);
    } finally { await session.close(); }
  });
}

test("native malformed ownership and truthy lock values remain denied through GraphQL", async () => {
  const session = driver.session();
  try {
    await session.run(`MATCH(u:User{username:'normaluser'})
      CREATE(raw:User{username:123})-[:AUTHORED_COMMENT]->(:Comment{id:'raw-owner'})
      CREATE(i:Issue{id:'raw-lock',locked:'false',title:'original'})-[:AUTHORED_ISSUE]->(u)`);
    const authorization = mockToken({username:'normaluser',email:'normal@e2e.test'});
    const comment = await execDeleteComments('raw-owner', authorization);
    assert.ok(comment.errors?.length);
    assert.equal(await countComment('raw-owner'),1);
    const issue = await graphql({
      schema,
      source: `mutation { updateIssues(where:{id:{eq:"raw-lock"}},update:{title:{set:"changed"}}) {issues{id}} }`,
      contextValue: {driver,req:{headers:{authorization},body:{},isMutation:true}},
    });
    assert.ok(issue.errors?.some(error => error.path?.[0] === 'updateIssues'), JSON.stringify(issue));
    const result = await session.run("MATCH(i:Issue{id:'raw-lock'}) RETURN i.title AS title");
    assert.equal(result.records[0].get('title'),'original');
  } finally { await session.close(); }
});

const remainingOwnershipCases = [
  {name:'channel owner', seed:`MATCH(own:User{username:'normaluser'}),(other:User{username:'adminuser'})
    CREATE(own)-[:ADMIN_OF_CHANNEL]->(:Channel{uniqueName:'cache-own-forum'})
    CREATE(other)-[:ADMIN_OF_CHANNEL]->(:Channel{uniqueName:'cache-other-forum'})`,
   allowed:`deleteChannels(where:{uniqueName:{eq:"cache-own-forum"}}){nodesDeleted}`,
   denied:`deleteChannels(where:{uniqueName:{eq:"cache-other-forum"}}){nodesDeleted}`,
   read:`MATCH(n:Channel) WHERE n.uniqueName STARTS WITH 'cache-' RETURN n.uniqueName AS value`, expected:['cache-other-forum']},
  {name:'image uploader', seed:`MATCH(own:User{username:'normaluser'}),(other:User{username:'adminuser'})
    CREATE(own)-[:UPLOADED_IMAGE]->(:Image{id:'cache-own-image',caption:'original'})
    CREATE(other)-[:UPLOADED_IMAGE]->(:Image{id:'cache-other-image',caption:'original'})`,
   allowed:`updateImages(where:{id:{eq:"cache-own-image"}},update:{caption:{set:"changed"}}){images{id}}`,
   denied:`updateImages(where:{id:{eq:"cache-other-image"}},update:{caption:{set:"changed"}}){images{id}}`,
   read:`MATCH(n:Image) WHERE n.id IN ['cache-other-image','cache-own-image'] RETURN n.caption AS value ORDER BY n.id`,expected:['original','changed']},
  {name:'discussion channel owner', seed:`MATCH(own:User{username:'normaluser'}),(other:User{username:'adminuser'})
    CREATE(own)-[:POSTED_DISCUSSION]->(d1:Discussion{id:'cache-own-discussion'})
    CREATE(other)-[:POSTED_DISCUSSION]->(d2:Discussion{id:'cache-other-discussion'})
    CREATE(c:Channel{uniqueName:'cache-discussion-forum'})
    CREATE(:DiscussionChannel{id:'cache-own-dc',discussionId:d1.id,channelUniqueName:c.uniqueName,locked:false})-[:POSTED_IN_CHANNEL]->(d1)
    CREATE(:DiscussionChannel{id:'cache-other-dc',discussionId:d2.id,channelUniqueName:c.uniqueName,locked:false})-[:POSTED_IN_CHANNEL]->(d2)`,
   allowed:`updateDiscussionChannels(where:{discussionId:{eq:"cache-own-discussion"},channelUniqueName:{eq:"cache-discussion-forum"}},update:{locked:{set:true}}){discussionChannels{id}}`,
   denied:`updateDiscussionChannels(where:{discussionId:{eq:"cache-other-discussion"},channelUniqueName:{eq:"cache-discussion-forum"}},update:{locked:{set:true}}){discussionChannels{id}}`,
   read:`MATCH(n:DiscussionChannel) WHERE n.id IN ['cache-other-dc','cache-own-dc'] RETURN n.locked AS value ORDER BY n.id`,expected:[false,true]},
  {name:'issue lock', seed:`MATCH(own:User{username:'normaluser'})
    CREATE(:Issue{id:'cache-unlocked',locked:false,title:'original'})-[:AUTHORED_ISSUE]->(own)
    CREATE(:Issue{id:'cache-locked',locked:true,title:'original'})-[:AUTHORED_ISSUE]->(own)`,
   allowed:`updateIssues(where:{id:{eq:"cache-unlocked"}},update:{title:{set:"changed"}}){issues{id}}`,
   denied:`updateIssues(where:{id:{eq:"cache-locked"}},update:{title:{set:"changed"}}){issues{id}}`,
   read:`MATCH(n:Issue) WHERE n.id IN ['cache-locked','cache-unlocked'] RETURN n.title AS value ORDER BY n.id`,expected:['original','changed']},
];
for (const item of remainingOwnershipCases) {
  test(`${item.name} decisions are scoped to the actual target`, async () => {
    const session=driver.session();
    try {
      await session.run(item.seed);
      const result=await graphql({schema,source:`mutation {allowed:${item.allowed} denied:${item.denied}}`,
        contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}}});
      assert.ok(result.errors?.some(error=>error.path?.[0]==='denied'),JSON.stringify(result));
      assert.ok(!result.errors?.some(error=>error.path?.[0]==='allowed'),JSON.stringify(result));
      const rows=await session.run(item.read);
      assert.deepEqual(rows.records.map(row=>row.get('value')),item.expected);
    } finally {await session.close();}
  });
}

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

async function withRoleManager(run: () => Promise<void>) {
  const session=driver.session();
  try {
    const previous=await session.run('MATCH(s:ServerConfig{serverName:$name})-[:HAS_DEFAULT_SERVER_ROLE]->(r:ServerRole) RETURN r.canManageRoles AS capability',{name:SERVER_CONFIG_NAME});
    await session.run('MATCH(s:ServerConfig{serverName:$name})-[:HAS_DEFAULT_SERVER_ROLE]->(r:ServerRole) SET r.canManageRoles=true',{name:SERVER_CONFIG_NAME});
    try {await run();}
    finally {await session.run('MATCH(s:ServerConfig{serverName:$name})-[:HAS_DEFAULT_SERVER_ROLE]->(r:ServerRole) SET r.canManageRoles=$previous',{name:SERVER_CONFIG_NAME,previous:previous.records[0].get('capability')});}
  } finally {await session.close();}
}
for (const role of [
  {label:'ServerRole',mutation:'createServerRoles',field:'serverRoles',capability:'canManageAdmins'},
  {label:'ModServerRole',mutation:'createModServerRoles',field:'modServerRoles',capability:'canEditComments'},
]) {
  test(`${role.mutation} validates each alias capability input`,async()=>withRoleManager(async()=>{
    const result=await graphql({schema,source:`mutation {
      allowed:${role.mutation}(input:[{name:"cache-safe-${role.label}",${role.capability}:false}]){${role.field}{name}}
      denied:${role.mutation}(input:[{name:"cache-denied-${role.label}",${role.capability}:true}]){${role.field}{name}}
    }`,contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}}});
    assert.ok(result.errors?.some(error=>error.path?.[0]==='denied'),JSON.stringify(result));
    const rows=await driver.executeQuery(`MATCH(r:${role.label}) WHERE r.name IN [$safe,$denied] RETURN r.name AS name`,{safe:`cache-safe-${role.label}`,denied:`cache-denied-${role.label}`});
    assert.deepEqual(rows.records.map(row=>row.get('name')),[`cache-safe-${role.label}`]);
  }));
}

test('mod role updates check capabilities carried by generated scalar set inputs',async()=>withRoleManager(async()=>{
  await driver.executeQuery("CREATE(:ModServerRole{name:'scalar-update-role',canEditComments:false})");
  const allowed=await graphql({schema,source:`mutation {updateModServerRoles(where:{name:{eq:"scalar-update-role"}},update:{canEditComments:{set:false}}){modServerRoles{name}}}`,
    contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}}});
  assert.equal(allowed.errors,undefined,JSON.stringify(allowed));
  const result=await graphql({schema,source:`mutation {updateModServerRoles(where:{name:{eq:"scalar-update-role"}},update:{canEditComments:{set:true}}){modServerRoles{name}}}`,
    contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}}});
  assert.ok(result.errors?.some(error=>error.path?.[0]==='updateModServerRoles'),JSON.stringify(result));
  const rows=await driver.executeQuery("MATCH(r:ModServerRole{name:'scalar-update-role'}) RETURN r.canEditComments AS capability");
  assert.equal(rows.records[0].get('capability'),false);
}));


for (const role of [
  {label:'ChannelRole',plural:'ChannelRoles',field:'channelRoles',relation:'OWNS_CHANNEL_ROLE'},
  {label:'ModChannelRole',plural:'ModChannelRoles',field:'modChannelRoles',relation:'OWNS_MOD_CHANNEL_ROLE'},
]) {
  for (const action of ['update','delete']) {
    test(`${action}${role.plural} isolates owner checks across aliases`,async()=>{
      const prefix=`role-scope-${action}-${role.label}`;
      const own=`${prefix}-own`,other=`${prefix}-other`;
      await driver.executeQuery(`MATCH(a:User{username:'normaluser'}),(b:User{username:'adminuser'})
        CREATE(a)-[:ADMIN_OF_CHANNEL]->(own:Channel{uniqueName:$own})
        CREATE(b)-[:ADMIN_OF_CHANNEL]->(other:Channel{uniqueName:$other})`,{own,other});
      await driver.executeQuery(`UNWIND [$own,$other] AS name MATCH(c:Channel{uniqueName:name})
        CREATE(c)-[:${role.relation}]->(:${role.label}{id:name,name:name,channelUniqueName:name,description:'original'})`,{own,other});
      const operation=(name:string)=> action==='update'
        ? `update${role.plural}(where:{id:{eq:"${name}"}},update:{description:{set:"changed"}}){${role.field}{name}}`
        : `delete${role.plural}(where:{id:{eq:"${name}"}}){nodesDeleted}`;
      const result=await graphql({schema,source:`mutation {allowed:${operation(own)} denied:${operation(other)}}`,
        contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}}});
      assert.ok(result.errors?.some(error=>error.path?.[0]==='denied'),JSON.stringify(result));
      assert.ok(!result.errors?.some(error=>error.path?.[0]==='allowed'),JSON.stringify(result));
      const rows=await driver.executeQuery(`MATCH(r:${role.label}) WHERE r.name IN [$own,$other] RETURN r.name AS name,r.description AS description ORDER BY r.name`,{own,other});
      assert.deepEqual(rows.records.map(row=>({name:row.get('name'),description:row.get('description')})),
        action==='delete' ? [{name:other,description:'original'}] : [{name:other,description:'original'},{name:own,description:'changed'}]);
    });
  }
}

test('user update validation applies to each alias independently',async()=>{
  const result=await graphql({schema,source:`mutation($bio:String!){
    allowed:updateUsers(where:{username:{eq:"normaluser"}},update:{bio:{set:"valid profile"}}){users{username}}
    denied:updateUsers(where:{username:{eq:"normaluser"}},update:{bio:{set:$bio}}){users{username}}
  }`,variableValues:{bio:'x'.repeat(501)},contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}}});
  assert.ok(result.errors?.some(error=>error.path?.[0]==='denied'));
  assert.equal(await readBio('normaluser'),'valid profile');
});

test('image update validation isolates protected storage fields from a permitted alias',async()=>{
  await driver.executeQuery("MATCH(u:User{username:'normaluser'}) CREATE(u)-[:UPLOADED_IMAGE]->(:Image{id:'audit-field-alias',caption:'original',storageBucket:'original-bucket'})");
  const result=await graphql({schema,source:`mutation {
    allowed:updateImages(where:{id:{eq:"audit-field-alias"}},update:{caption:{set:"valid caption"}}){images{id}}
    denied:updateImages(where:{id:{eq:"audit-field-alias"}},update:{storageBucket:{set:"changed-bucket"}}){images{id}}
  }`,contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}}});
  assert.ok(result.errors?.some(error=>error.path?.[0]==='denied'),JSON.stringify(result));
  const rows=await driver.executeQuery("MATCH(i:Image{id:'audit-field-alias'}) RETURN i.caption AS caption,i.storageBucket AS bucket");
  assert.equal(rows.records[0].get('caption'),'valid caption');
  assert.equal(rows.records[0].get('bucket'),'original-bucket');
});

async function seedIdentityAccounts() {
  await driver.executeQuery(`MATCH(u:User) WHERE u.username IN ['normaluser','adminuser']
    SET u.bio='normaluser'
    MERGE(e:Email{address:u.username+'@private.test'}) MERGE(e)-[:HAS_EMAIL]->(u)`);
}

for (const selection of [
  'contact:Email{address}',
  '...PrivateAccount',
  '... on User {contact:Email{address}}',
  'renamed:username contact:Email{address}',
  '_accountIdentity:bio username:bio contact:Email{address}',
]) {
  test(`selection-aware account identity supports ${selection}`, async () => {
    await seedIdentityAccounts();
    const fragment = selection === '...PrivateAccount' ? 'fragment PrivateAccount on User { contact:Email{address} }' : '';
    const response = await graphql({schema,
      source:`query { users(where:{username:{in:["normaluser","adminuser"]}},sort:[{username:ASC}]) {${selection}} } ${fragment}`,
      contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}},
    });
    assert.deepEqual(response.errors?.map(error=>error.path),[['users',0,'contact']],JSON.stringify(response));
    const users = JSON.parse(JSON.stringify(response.data)).users;
    assert.equal(users[0].contact,null);
    assert.deepEqual(users[1].contact,{address:'normaluser@private.test'});
    assert.ok(users.every((row:object)=>!Object.keys(row).includes('_accountIdentity_')));
    if (!selection.includes('_accountIdentity:')) assert.ok(users.every((row:object)=>!Object.keys(row).includes('_accountIdentity')));
  });
}

test('selection-aware account identity preserves skipped fields and independent merged selections',async()=>{
  await seedIdentityAccounts();
  const response=await graphql({schema,source:`query($hide:Boolean! = true,$show:Boolean! = false){
    own:users(where:{username:{eq:"normaluser"}}){...PrivateAccount @skip(if:$hide) bio}
    own:users(where:{username:{eq:"normaluser"}}){renamed:username}
    other:users(where:{username:{eq:"adminuser"}}){... on User @include(if:$show){Email{address}} bio}
  } fragment PrivateAccount on User { Email{address} }`,
    contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}},
  });
  assert.equal(response.errors,undefined,JSON.stringify(response));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{own:[{bio:'normaluser',renamed:'normaluser'}],other:[{bio:'normaluser'}]});
});

test('selection-aware account identity denies anonymous access without selecting username',async()=>{
  await seedIdentityAccounts();
  const response=await graphql({schema,source:'{users(where:{username:{eq:"normaluser"}}){Email{address}}}',contextValue:{driver,req:{headers:{},body:{}}}});
  assert.ok(response.errors?.length,JSON.stringify(response));
  assert.equal(JSON.stringify(response.data).includes('normaluser@private.test'),false);
});

test('selection-aware account identity keeps requested-field errors at their original path',async()=>{
  await driver.executeQuery("MATCH(u:User{username:'normaluser'}) SET u.bio=['invalid'] MERGE(e:Email{address:'normaluser@private.test'}) MERGE(e)-[:HAS_EMAIL]->(u)");
  try {
    const response=await graphql({schema,source:'{users(where:{username:{eq:"normaluser"}}){broken:bio contact:Email{address}}}',contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}}});
    assert.deepEqual(response.errors?.map(error=>error.path),[['users',0,'broken']],JSON.stringify(response));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{users:[{broken:null,contact:{address:'normaluser@private.test'}}]});
  } finally {await driver.executeQuery("MATCH(u:User{username:'normaluser'}) SET u.bio='normaluser'");}
});

 test('selection-aware account identity supports a single owner without a sort dependency',async()=>{
  await seedIdentityAccounts();
  const response=await graphql({schema,source:'{users(where:{username:{eq:"normaluser"}}){Email{address}}}',contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}}});
  assert.equal(response.errors,undefined,JSON.stringify(response));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{users:[{Email:{address:'normaluser@private.test'}}]});
});

test('selection-aware account identity supports active directive variables and merged private selections',async()=>{
  await seedIdentityAccounts();
  const response=await graphql({schema,source:`query($hide:Boolean!,$show:Boolean!){
    own:users(where:{username:{eq:"normaluser"}}){...PrivateAccount @skip(if:$hide)}
    own:users(where:{username:{eq:"normaluser"}}){renamed:username}
    other:users(where:{username:{eq:"adminuser"}}){... on User @include(if:$show){contact:Email{address}}}
  } fragment PrivateAccount on User {contact:Email{address}}`,variableValues:{hide:false,show:true},
    contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}},
  });
  assert.deepEqual(response.errors?.map(error=>error.path),[['other',0,'contact']],JSON.stringify(response));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{own:[{contact:{address:'normaluser@private.test'},renamed:'normaluser'}],other:[{contact:null}]});
});

test('selection-aware account identity preserves empty matches, pagination and nullable private fields',async()=>{
  await driver.executeQuery("MATCH(u:User{username:'normaluser'}) SET u.stripeAccountId=null");
  const response=await graphql({schema,source:`{
    missing:users(where:{username:{eq:"not-an-account"}}){Email{address}}
    page:users(where:{username:{in:["adminuser","normaluser"]}},sort:[{username:ASC}],offset:1,limit:1){stripeAccountId}
  }`,contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}}});
  assert.equal(response.errors,undefined,JSON.stringify(response));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{missing:[],page:[{stripeAccountId:null}]});
});

for(const order of ['ASC','DESC'])test(`account child permission accepts native integer siblings in ${order} order`,async()=>{
 await seedIdentityAccounts();
 await driver.executeQuery("MATCH(u:User) WHERE u.username IN ['normaluser','adminuser'] SET u.commentKarma=3,u.discussionKarma=5");
 const response=await graphql({schema,source:`{users(where:{username:{in:["normaluser","adminuser"]}},sort:[{username:${order}}]){commentKarma discussionKarma Email{address}}}`,contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}}});
 const deniedIndex=order==='ASC'?0:1;
 assert.deepEqual(response.errors?.map(error=>error.path),[['users',deniedIndex,'Email']],JSON.stringify(response));
 const owner={commentKarma:3,discussionKarma:5,Email:{address:'normaluser@private.test'}};
 const other={commentKarma:3,discussionKarma:5,Email:null};
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{users:order==='ASC'?[other,owner]:[owner,other]});
});

test('account child permission does not hash malformed native integer siblings before completion',async()=>{
 await seedIdentityAccounts();
 await driver.executeQuery("MATCH(u:User{username:'normaluser'}) SET u.bio=[1,2]");
 try {
  const response=await graphql({schema,source:'{users(where:{username:{eq:"normaluser"}}){broken:bio contact:Email{address}}}',contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}}});
  assert.deepEqual(response.errors?.map(error=>error.path),[['users',0,'broken']],JSON.stringify(response));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{users:[{broken:null,contact:{address:'normaluser@private.test'}}]});
 } finally {await driver.executeQuery("MATCH(u:User{username:'normaluser'}) SET u.bio='normaluser'");}
});

for(const fields of ['users{Email{address}}','accounts:users{...Private}'])test(`updated account child identity supports ${fields}`,async()=>{
 await seedIdentityAccounts();
 const fragment=fields.includes('...Private')?'fragment Private on User{contact:Email{address}}':'';
 const response=await graphql({schema,source:`mutation{updateUsers(where:{username:{eq:"normaluser"}},update:{bio:{set:"updated"}}){${fields}}} ${fragment}`,contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}}});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{updateUsers:fields.startsWith('accounts')?{accounts:[{contact:{address:'normaluser@private.test'}}]}:{users:[{Email:{address:'normaluser@private.test'}}]}});
 const persisted=await driver.executeQuery("MATCH(u:User{username:'normaluser'}) RETURN u.bio AS bio");
 assert.equal(persisted.records[0].get('bio'),'updated');
});

for(const username of ['normaluser',null])test(`updated account child identity retains denied writes for ${username??'anonymous'}`,async()=>{
 await seedIdentityAccounts();
 const response=await graphql({schema,source:'mutation{updateUsers(where:{username:{eq:"adminuser"}},update:{bio:{set:"must-not-write"}}){users{Email{address}}}}',contextValue:{driver,req:{headers:username?{authorization:mockToken({username,email:'normal@e2e.test'})}:{},body:{},isMutation:true}}});
 assert.ok(response.errors?.length,JSON.stringify(response));
 const persisted=await driver.executeQuery("MATCH(u:User{username:'adminuser'}) RETURN u.bio AS bio");
 assert.equal(persisted.records[0].get('bio'),'normaluser');
});

test('updated account child identity preserves empty matches and skipped child selections',async()=>{
 await seedIdentityAccounts();
 const response=await graphql({schema,source:`mutation($hide:Boolean!=true){
  empty:updateUsers(where:{username:{eq:"normaluser"},bio:{eq:"not-current"}},update:{bio:{set:"must-not-write"}}){users{Email{address}}}
  own:updateUsers(where:{username:{eq:"normaluser"}},update:{bio:{set:"updated"}}){users{renamed:username Email @skip(if:$hide){address}}}
 }`,contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{},isMutation:true}}});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{empty:{users:[]},own:{users:[{renamed:'normaluser'}]}});
});

test('user connection source supplies identity to owner-only children without username selection',async()=>{
 await seedIdentityAccounts();
 const response=await graphql({schema,source:'{usersConnection(where:{username:{eq:"normaluser"}},first:1){totalCount edges{node{Email{address}}}}}',contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}}});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{usersConnection:{totalCount:1,edges:[{node:{Email:{address:'normaluser@private.test'}}}]}});
});

for(const username of ['normaluser',null])test(`user connection identity preserves aliases and private-field denial for ${username??'anonymous'}`,async()=>{
 await seedIdentityAccounts();
 const response=await graphql({schema,source:`query($show:Boolean!=true){
  page:usersConnection(where:{username:{in:["normaluser","adminuser"]}},sort:[{username:ASC}]){
   count:totalCount links:edges{person:node{username:bio _accountIdentity:bio ...Private @include(if:$show)}}
  }
 } fragment Private on User {contact:Email{address}}`,contextValue:{driver,req:{headers:username?{authorization:mockToken({username,email:'normal@e2e.test'})}:{},body:{}}}});
 const expectedPaths=username?[['page','links',0,'person','contact']]:[['page','links',0,'person','contact'],['page','links',1,'person','contact']];
 assert.deepEqual(response.errors?.map(error=>error.path),expectedPaths,JSON.stringify(response));
 const person=(own:boolean)=>({username:'normaluser',_accountIdentity:'normaluser',contact:own?{address:'normaluser@private.test'}:null});
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{page:{count:2,links:[{person:person(false)},{person:person(Boolean(username))}]}});
});

test('user connection identity preserves cursors, empty pages, and skipped private fields',async()=>{
 await seedIdentityAccounts();
 const exec=(source:string,variableValues?:Record<string,unknown>)=>graphql({schema,source,variableValues,contextValue:{driver,req:{headers:{authorization:mockToken({username:'normaluser',email:'normal@e2e.test'})},body:{}}}});
 const first=await exec('{usersConnection(where:{username:{in:["adminuser","normaluser"]}},sort:[{username:ASC}],first:1){totalCount pageInfo{endCursor hasNextPage} edges{node{renamed:username Email @skip(if:true){address}}}}}');
 assert.equal(first.errors,undefined,JSON.stringify(first.errors));
 const firstPage=JSON.parse(JSON.stringify(first.data)).usersConnection;
 assert.equal(firstPage.totalCount,2);assert.equal(firstPage.pageInfo.hasNextPage,true);
 assert.deepEqual(firstPage.edges,[{node:{renamed:'adminuser'}}]);
 const next=await exec('query($after:String!){usersConnection(where:{username:{in:["adminuser","normaluser"]}},sort:[{username:ASC}],first:1,after:$after){edges{node{Email{address}}} pageInfo{hasNextPage}}}',{after:firstPage.pageInfo.endCursor});
 assert.equal(next.errors,undefined,JSON.stringify(next.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(next.data)),{usersConnection:{edges:[{node:{Email:{address:'normaluser@private.test'}}}],pageInfo:{hasNextPage:false}}});
 const empty=await exec('{usersConnection(where:{username:{eq:"missing-user"}}){edges{node{Email{address}}} totalCount}}');
 assert.equal(empty.errors,undefined,JSON.stringify(empty.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(empty.data)),{usersConnection:{edges:[],totalCount:0}});
});

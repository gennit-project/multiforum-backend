import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import { mockToken } from "./imageModerationHarness.js";

const SERVER_CONFIG_NAME = "AgeGatingReadTestServer";
const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";
const CURRENT_YEAR = new Date().getUTCFullYear();
const ADULT_BIRTHDAY = `${CURRENT_YEAR - 25}-01-01`;
const MINOR_BIRTHDAY = `${CURRENT_YEAR - 10}-01-01`;
const UNDERAGE_ACCOUNT_BIRTHDAY = `${CURRENT_YEAR - 5}-01-01`;

let container: StartedNeo4jContainer;
let schema: GraphQLSchema;
let driver: Driver;
let ogm: any;

before(async () => {
  let builder = new Neo4jContainer("neo4j:5-community").withApoc();
  if (REUSE) builder = builder.withReuse();
  container = await builder.start();
  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  process.env.E2E_MOCK_AUTH = "true";
  process.env.SERVER_CONFIG_NAME = SERVER_CONFIG_NAME;

  const { buildPermissionedSchema } = await import(
    "../helpers/buildPermissionedSchema.js"
  );
  ({ schema, driver, ogm } = await buildPermissionedSchema());
  await ogm.init();
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  if (!REUSE) await container?.stop();
});

beforeEach(async () => {
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
    await session.run(
      `CREATE (config:ServerConfig {
         serverName: $serverName,
         accountAgeGateEnabled: true,
         minimumAccountAge: 13,
         sensitiveContentAgeGateEnabled: true,
         minimumSensitiveContentAge: 18
       })
       CREATE (adult:User {username: 'adult', dateOfBirth: date($adultBirthday)})
       CREATE (minor:User {username: 'minor', dateOfBirth: date($minorBirthday)})
       CREATE (unknownAge:User {username: 'unknown-age'})
       CREATE (channel:Channel {uniqueName: 'general', displayName: 'General'})
       CREATE (publicDiscussion:Discussion {
         id: 'discussion-public', title: 'Public', hasSensitiveContent: false,
         createdAt: datetime('2026-01-01T00:00:00Z')
       })
       CREATE (sensitiveDiscussion:Discussion {
         id: 'discussion-sensitive', title: 'Sensitive', hasSensitiveContent: true,
         createdAt: datetime('2026-01-02T00:00:00Z')
       })
       CREATE (publicDc:DiscussionChannel {
         id: 'dc-public', discussionId: 'discussion-public',
         channelUniqueName: 'general', createdAt: datetime('2026-01-01T00:00:00Z')
       })
       CREATE (sensitiveDc:DiscussionChannel {
         id: 'dc-sensitive', discussionId: 'discussion-sensitive',
         channelUniqueName: 'general', createdAt: datetime('2026-01-02T00:00:00Z')
       })
       CREATE (publicComment:Comment {
         id: 'comment-public', text: 'Public comment', isRootComment: true,
         createdAt: datetime('2026-01-01T01:00:00Z')
       })
       CREATE (sensitiveComment:Comment {
         id: 'comment-sensitive', text: 'Sensitive comment', isRootComment: true,
         createdAt: datetime('2026-01-02T01:00:00Z')
       })
       CREATE (publicIssue:Issue {
         id: 'issue-public', issueNumber: 1, isOpen: true,
         relatedDiscussionId: 'discussion-public'
       })
       CREATE (sensitiveIssue:Issue {
         id: 'issue-sensitive', issueNumber: 2, isOpen: true,
         relatedDiscussionId: 'discussion-sensitive'
       })
       CREATE (publicImage:Image {
         id: 'image-public', url: 'https://example.test/public.png',
         hasSensitiveContent: false
       })
       CREATE (sensitiveImage:Image {
         id: 'image-sensitive', url: 'https://example.test/sensitive.png',
         hasSensitiveContent: true
       })
       CREATE (publicFile:DownloadableFile {id: 'file-public'})
       CREATE (sensitiveFile:DownloadableFile {id: 'file-sensitive'})
       CREATE (publicFileVersion:FileVersion {id: 'file-version-public'})
       CREATE (sensitiveFileVersion:FileVersion {id: 'file-version-sensitive'})
       CREATE (publicDc)-[:POSTED_IN_CHANNEL]->(publicDiscussion)
       CREATE (publicDc)-[:POSTED_IN_CHANNEL]->(channel)
       CREATE (sensitiveDc)-[:POSTED_IN_CHANNEL]->(sensitiveDiscussion)
       CREATE (sensitiveDc)-[:POSTED_IN_CHANNEL]->(channel)
       CREATE (publicDc)-[:CONTAINS_COMMENT]->(publicComment)
       CREATE (sensitiveDc)-[:CONTAINS_COMMENT]->(sensitiveComment)
       CREATE (publicDiscussion)-[:HAS_DOWNLOADABLE_FILE]->(publicFile)
       CREATE (sensitiveDiscussion)-[:HAS_DOWNLOADABLE_FILE]->(sensitiveFile)
       CREATE (publicFile)-[:HAS_VERSION]->(publicFileVersion)
       CREATE (sensitiveFile)-[:HAS_VERSION]->(sensitiveFileVersion)`,
      {
        serverName: SERVER_CONFIG_NAME,
        adultBirthday: ADULT_BIRTHDAY,
        minorBirthday: MINOR_BIRTHDAY,
      }
    );
  } finally {
    await session.close();
  }
});

const contextFor = (username?: string) => ({
  driver,
  ogm,
  req: {
    headers: username
      ? { authorization: `Bearer ${mockToken({ username, email: `${username}@e2e.test` })}` }
      : {},
    body: {},
  },
});

const execute = (source: string, username?: string) =>
  graphql({ schema, source, contextValue: contextFor(username) });

const executeAsVerifiedEmail = (source: string, email: string) =>
  graphql({
    schema,
    source,
    contextValue: {
      driver,
      ogm,
      req: {
        headers: { authorization: `Bearer ${mockToken({ email })}` },
        body: {},
        isMutation: true,
      },
    },
  });

const nodeCount = async (
  label: "User" | "Email",
  property: string,
  value: string
) => {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (node:${label}) WHERE node[$property] = $value RETURN count(node) AS count`,
      { property, value }
    );
    return result.records[0]?.get("count").toNumber() ?? 0;
  } finally {
    await session.close();
  }
};

const visibleIds = async (username?: string) => {
  const result = await execute(
    `query {
      discussions(options: { sort: [{ id: ASC }] }) { id }
      discussionChannels(options: { sort: [{ id: ASC }] }) { id }
      comments(options: { sort: [{ id: ASC }] }) { id }
      issues(options: { sort: [{ id: ASC }] }) { id }
      images(options: { sort: [{ id: ASC }] }) { id }
      downloadableFiles(options: { sort: [{ id: ASC }] }) { id }
      fileVersions(options: { sort: [{ id: ASC }] }) { id }
      discussionsAggregate { count }
      channels(where: { uniqueName: "general" }) {
        DiscussionChannels(options: { sort: [{ id: ASC }] }) { id }
      }
    }`,
    username
  );

  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return result.data as any;
};

for (const [label, username] of [
  ["anonymous callers", undefined],
  ["underage callers", "minor"],
  ["callers without a birthday", "unknown-age"],
] as const) {
  test(`${label} cannot read sensitive nodes through direct, aggregate, or nested paths`, async () => {
    const data = await visibleIds(username);
    assert.deepEqual(data.discussions.map((item: any) => item.id), ["discussion-public"]);
    assert.deepEqual(data.discussionChannels.map((item: any) => item.id), ["dc-public"]);
    assert.deepEqual(data.comments.map((item: any) => item.id), ["comment-public"]);
    assert.deepEqual(data.issues.map((item: any) => item.id), ["issue-public"]);
    assert.deepEqual(data.images.map((item: any) => item.id), ["image-public"]);
    assert.deepEqual(data.downloadableFiles.map((item: any) => item.id), [
      "file-public",
    ]);
    assert.deepEqual(data.fileVersions.map((item: any) => item.id), [
      "file-version-public",
    ]);
    assert.equal(data.discussionsAggregate.count, 1);
    assert.deepEqual(
      data.channels[0].DiscussionChannels.map((item: any) => item.id),
      ["dc-public"]
    );
  });
}

test("an age-eligible caller can read sensitive nodes", async () => {
  const data = await visibleIds("adult");
  assert.deepEqual(data.discussions.map((item: any) => item.id), [
    "discussion-public",
    "discussion-sensitive",
  ]);
  assert.deepEqual(data.discussionChannels.map((item: any) => item.id), [
    "dc-public",
    "dc-sensitive",
  ]);
  assert.deepEqual(data.comments.map((item: any) => item.id), [
    "comment-public",
    "comment-sensitive",
  ]);
  assert.deepEqual(data.issues.map((item: any) => item.id), [
    "issue-public",
    "issue-sensitive",
  ]);
  assert.deepEqual(data.images.map((item: any) => item.id), [
    "image-public",
    "image-sensitive",
  ]);
  assert.deepEqual(data.downloadableFiles.map((item: any) => item.id), [
    "file-public",
    "file-sensitive",
  ]);
  assert.deepEqual(data.fileVersions.map((item: any) => item.id), [
    "file-version-public",
    "file-version-sensitive",
  ]);
  assert.equal(data.discussionsAggregate.count, 2);
});

test("the public API rejects account creation without a birthday when gating is enabled", async () => {
  const result = await executeAsVerifiedEmail(
    `mutation {
      createEmailAndUser(
        emailAddress: "missing-birthday@example.test"
        username: "missingbirthday"
      ) { username }
    }`,
    "missing-birthday@example.test"
  );

  assert.match(result.errors?.[0]?.message ?? "", /BIRTHDAY_REQUIRED/);
  assert.equal(await nodeCount("User", "username", "missingbirthday"), 0);
  assert.equal(
    await nodeCount("Email", "address", "missing-birthday@example.test"),
    0
  );
});

test("the public API rejects an underage account without creating identity data", async () => {
  const result = await executeAsVerifiedEmail(
    `mutation {
      createEmailAndUser(
        emailAddress: "underage@example.test"
        username: "underageperson"
        birthday: "${UNDERAGE_ACCOUNT_BIRTHDAY}"
      ) { username }
    }`,
    "underage@example.test"
  );

  assert.match(result.errors?.[0]?.message ?? "", /MINIMUM_AGE_NOT_MET/);
  assert.equal(await nodeCount("User", "username", "underageperson"), 0);
  assert.equal(await nodeCount("Email", "address", "underage@example.test"), 0);
});

test("an eligible account can be created and read its own birthday", async () => {
  const mutation = await executeAsVerifiedEmail(
    `mutation {
      createEmailAndUser(
        emailAddress: "eligible@example.test"
        username: "eligibleperson"
        birthday: "2000-01-01"
      ) { username }
    }`,
    "eligible@example.test"
  );

  assert.equal(mutation.errors, undefined, JSON.stringify(mutation.errors));
  assert.equal(
    (mutation.data as any)?.createEmailAndUser?.username,
    "eligibleperson"
  );

  const profile = await execute(
    `query {
      getMyAgeProfile {
        birthday
        meetsAccountMinimumAge
        mayAccessSensitiveContent
      }
    }`,
    "eligibleperson"
  );
  assert.equal(profile.errors, undefined, JSON.stringify(profile.errors));
  assert.deepEqual({ ...(profile.data as any)?.getMyAgeProfile }, {
    birthday: "2000-01-01",
    meetsAccountMinimumAge: true,
    mayAccessSensitiveContent: true,
  });
});

test("birthday reads are self-scoped and anonymous callers receive no profile", async () => {
  const adultProfile = await execute(
    `query { getMyAgeProfile { birthday } }`,
    "adult"
  );
  const minorProfile = await execute(
    `query { getMyAgeProfile { birthday } }`,
    "minor"
  );
  const anonymousProfile = await execute(
    `query { getMyAgeProfile { birthday } }`
  );

  assert.equal(
    (adultProfile.data as any)?.getMyAgeProfile?.birthday,
    ADULT_BIRTHDAY
  );
  assert.equal(
    (minorProfile.data as any)?.getMyAgeProfile?.birthday,
    MINOR_BIRTHDAY
  );
  assert.equal((anonymousProfile.data as any)?.getMyAgeProfile, null);
});

test("birthday is absent from generated user query fields", async () => {
  const result = await execute(
    `query { users { username dateOfBirth } }`,
    "adult"
  );

  assert.match(
    result.errors?.[0]?.message ?? "",
    /Cannot query field "dateOfBirth" on type "User"/
  );
  assert.equal(result.data, undefined);
});

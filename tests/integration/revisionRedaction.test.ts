// Integration tests for the revision-redaction mutations against live Neo4j.
//
// The unit tests (customResolvers/mutations/redactTextVersionRevision.test.ts)
// mock getRevisionRedactionTarget, so they never exercise the real Cypher that
// walks Comment / Discussion / WikiPage -> TextVersion to resolve the revision's
// type, owner, and channel. These tests do, against a real graph — covering the
// author-authorship path for each of the three supported parent types plus the
// mismatched-mutation rejection.
//
// The server-admin and channel-mod-permission branches are covered by the unit
// tests + the dedicated permission-rule tests; they depend on a cached
// ServerConfig / SERVER_CONFIG_NAME that is awkward to seed reliably in the
// shared container, so they are intentionally not re-exercised here.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { REDACTED_REVISION_BODY } from "../../customResolvers/mutations/redactTextVersionRevision.js";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  mockToken,
  modContext,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
});

// An authenticated context for `username`; setUserDataOnContext decodes the
// mock JWT, so the resolver resolves the caller from these claims.
const ctxFor = (username: string) =>
  modContext(
    env,
    mockToken({ username, email: `${username}@e2e.test` })
  ) as unknown as GraphQLContext;

const bodyOf = async (textVersionId: string) => {
  const rows = await run(
    `MATCH (v:TextVersion { id: $textVersionId }) RETURN v.body AS body`,
    { textVersionId }
  );
  return rows[0]?.body as string | undefined;
};

const info = {} as unknown as GraphQLResolveInfo;

test("a comment author can redact their own comment revision", async () => {
  await run(
    `CREATE (alice:User { username: 'alice', createdAt: datetime() })
     CREATE (c:Comment { id: 'c1', text: 'old text', isRootComment: true, createdAt: datetime() })
     CREATE (v:TextVersion { id: 'v-comment', body: 'old text', createdAt: datetime() })
     CREATE (c)-[:HAS_VERSION]->(v)
     CREATE (alice)-[:AUTHORED_COMMENT]->(c)`
  );

  await env.resolvers.Mutation.deleteCommentRevision(
    null,
    { textVersionId: "v-comment" },
    ctxFor("alice"),
    info
  );

  assert.equal(await bodyOf("v-comment"), REDACTED_REVISION_BODY);
});

test("a discussion OP can redact their own discussion body revision", async () => {
  await run(
    `CREATE (alice:User { username: 'alice', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (v:TextVersion { id: 'v-discussion', body: 'old body', createdAt: datetime() })
     CREATE (d)-[:HAS_BODY_VERSION]->(v)
     CREATE (alice)-[:POSTED_DISCUSSION]->(d)`
  );

  await env.resolvers.Mutation.deleteDiscussionBodyRevision(
    null,
    { textVersionId: "v-discussion" },
    ctxFor("alice"),
    info
  );

  assert.equal(await bodyOf("v-discussion"), REDACTED_REVISION_BODY);
});

test("a wiki page original author can redact a wiki revision", async () => {
  await run(
    `CREATE (alice:User { username: 'alice', createdAt: datetime() })
     CREATE (w:WikiPage { id: 'w1', title: 'My Wiki', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (v:TextVersion { id: 'v-wiki', body: 'old wiki', createdAt: datetime() })
     CREATE (w)-[:HAS_VERSION]->(v)
     CREATE (alice)-[:AUTHORED_WIKI_PAGE]->(w)`
  );

  await env.resolvers.Mutation.deleteWikiRevision(
    null,
    { textVersionId: "v-wiki" },
    ctxFor("alice"),
    info
  );

  assert.equal(await bodyOf("v-wiki"), REDACTED_REVISION_BODY);
});

test("calling deleteCommentRevision with a wiki revision id is rejected", async () => {
  await run(
    `CREATE (alice:User { username: 'alice', createdAt: datetime() })
     CREATE (w:WikiPage { id: 'w1', title: 'My Wiki', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (v:TextVersion { id: 'v-wiki', body: 'old wiki', createdAt: datetime() })
     CREATE (w)-[:HAS_VERSION]->(v)
     CREATE (alice)-[:AUTHORED_WIKI_PAGE]->(w)`
  );

  await assert.rejects(
    env.resolvers.Mutation.deleteCommentRevision(
      null,
      { textVersionId: "v-wiki" },
      ctxFor("alice"),
      info
    ),
    /comment revision not found/
  );

  // The wiki revision is untouched by the mismatched mutation.
  assert.equal(await bodyOf("v-wiki"), "old wiki");
});

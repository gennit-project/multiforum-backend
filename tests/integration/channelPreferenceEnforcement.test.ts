// Channel feature-flag enforcement e2e: runs the REAL content-creation mutations
// through the REAL schema + graphql-shield against a live Neo4j, proving that a
// channel's feature flags actually block the corresponding submission.
//
// The flag checks live inside the input-validation shield rules
// (createEventInputIsValid / createCommentInputIsValid / createDiscussionInputIsValid),
// which sit in the same `and(...)` chain as the canCreate* permission rules.
// Pure unit tests (rules/validation/channelPreferences.test.ts) already cover the
// validation functions in isolation with stubbed models; what they CANNOT prove
// is that the rules are wired into the live mutations and that their messages
// survive graphql-shield. That wiring is exactly what these tests lock in.
//
// Caller: a server admin (CYPRESS_ADMIN_TEST_EMAIL seam). passesAsServerAdminOrRoot
// grants an admin every channel + channel-mod permission, so every canCreate*
// (and canGiveFeedback) gate passes — leaving the feature-flag check as the ONLY
// rule that can deny. That isolation is what lets us assert the exact flag error.
//
// shield is configured `{ debug: true }`, so a rule that THROWS (the event flag)
// is re-thrown with its message intact, and a rule that RETURNS A STRING (the
// feedback/download/image flags) is wrapped into an Error — both surface verbatim.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";

const ADMIN_EMAIL = "admin@channel-prefs.test";
const SERVER_CONFIG_NAME = "ChannelPrefsTestServer";
const ADMIN_USER = "adminuser";

const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let container: StartedNeo4jContainer;
let schema: GraphQLSchema;
let driver: Driver;
let ogm: any;

before(async () => {
  // APOC is required: the permission rules' OGM queries (suspension lookups,
  // and the discussion-channel create cypher) call apoc.* procedures.
  let builder = new Neo4jContainer("neo4j:5-community").withApoc();
  if (REUSE) builder = builder.withReuse();
  container = await builder.start();

  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  process.env.E2E_MOCK_AUTH = "true";
  process.env.CYPRESS_ADMIN_TEST_EMAIL = ADMIN_EMAIL;
  process.env.SERVER_CONFIG_NAME = SERVER_CONFIG_NAME;

  const { buildPermissionedSchema } = await import(
    "../helpers/buildPermissionedSchema.js"
  );
  ({ schema, driver, ogm } = await buildPermissionedSchema());
  await ogm.init();

  // Seed the admin caller and a ServerConfig with downloads enabled at the
  // SERVER level — so the server-level download gate (serverDownloadsEnabled)
  // always passes and the CHANNEL-level downloadsEnabled flag is the only thing
  // that can block a download in these tests. Empty server allowedFileTypes
  // means "no server restriction", leaving channel file-type rules in control.
  await run(
    `CREATE (:User { username: $username })
     CREATE (:ServerConfig {
       serverName: $name,
       enableDownloads: true,
       allowedFileTypes: []
     })`,
    { username: ADMIN_USER, name: SERVER_CONFIG_NAME }
  );

  // Provision the default roles so identity/permission resolution runs against
  // the same role graph production uses.
  const { provisionServerDefaultsFromOgm } = await import(
    "../../seedData/provisionServerDefaults.js"
  );
  await provisionServerDefaultsFromOgm(ogm, { serverName: SERVER_CONFIG_NAME });
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  if (!REUSE) await container?.stop();
});

async function run(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, any>[]> {
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
}

const adminToken = () =>
  `Bearer ${jwt.sign({ username: ADMIN_USER, email: ADMIN_EMAIL }, "mock-signing-key")}`;

const exec = (source: string, variableValues: Record<string, unknown>) =>
  graphql({
    schema,
    source,
    variableValues,
    contextValue: {
      driver,
      ogm,
      req: {
        headers: { authorization: adminToken() },
        body: {},
        isMutation: true,
      },
    },
  });

const firstErrorMessage = (result: Awaited<ReturnType<typeof graphql>>) =>
  result.errors?.[0]?.message;

const CREATE_EVENT = `
  mutation ($input: [EventCreateInputWithChannels!]!) {
    createEventWithChannelConnections(input: $input) { id title }
  }
`;

const CREATE_DISCUSSION = `
  mutation ($input: [DiscussionCreateInputWithChannels!]!) {
    createDiscussionWithChannelConnections(input: $input) { id title }
  }
`;

const CREATE_COMMENTS = `
  mutation ($input: [CommentCreateInput!]!) {
    createComments(input: $input) { comments { id } }
  }
`;

const eventInput = (channel: string) => [
  {
    eventCreateInput: {
      title: "Flag Test Event",
      startTime: "2026-06-01T10:00:00.000Z",
      endTime: "2026-06-01T12:00:00.000Z",
      canceled: false,
    },
    channelConnections: [channel],
  },
];

// --- eventsEnabled ----------------------------------------------------------

test("createEvent is blocked when the channel has events disabled", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'ev-off', eventsEnabled: false, createdAt: datetime() })`
  );

  const result = await exec(CREATE_EVENT, { input: eventInput("ev-off") });

  assert.equal(firstErrorMessage(result), "Events are disabled in channel 'ev-off'.");
});

test("no Event node is created when the channel has events disabled", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'ev-off-2', eventsEnabled: false, createdAt: datetime() })`
  );

  await exec(CREATE_EVENT, { input: eventInput("ev-off-2") });

  const rows = await run(
    `MATCH (ec:EventChannel { channelUniqueName: 'ev-off-2' }) RETURN count(ec) AS n`
  );
  assert.equal(Number(rows[0].n), 0);
});

test("createEvent succeeds when the channel has events enabled", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'ev-on', eventsEnabled: true, createdAt: datetime() })`
  );

  const result = await exec(CREATE_EVENT, { input: eventInput("ev-on") });

  assert.equal(result.errors, undefined, `unexpected errors: ${JSON.stringify(result.errors)}`);
});

// --- feedbackEnabled --------------------------------------------------------

// A feedback comment targets a discussion via GivesFeedbackOnDiscussion and
// carries a DiscussionChannel (so canCreateComment can resolve the channel and
// run its canGiveFeedback mod check, which the admin passes). The feedbackEnabled
// flag check in createCommentInputIsValid is then the only rule that can deny.
const seedFeedbackTarget = async (channel: string, feedbackEnabled: boolean) => {
  await run(
    `CREATE (ch:Channel { uniqueName: $channel, feedbackEnabled: $feedbackEnabled, createdAt: datetime() })
     CREATE (d:Discussion { id: $discussionId, title: 'Target', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: $discussionChannelId, channelUniqueName: $channel, discussionId: $discussionId, locked: false, archived: false, createdAt: datetime() })
     MERGE (dc)-[:POSTED_IN_CHANNEL]->(d)
     MERGE (dc)-[:POSTED_IN_CHANNEL]->(ch)`,
    {
      channel,
      feedbackEnabled,
      discussionId: `disc-${channel}`,
      discussionChannelId: `dc-${channel}`,
    }
  );
};

const feedbackCommentInput = (channel: string) => [
  {
    text: "Please improve this.",
    isRootComment: false,
    isFeedbackComment: true,
    Channel: { connect: { where: { node: { uniqueName: channel } } } },
    DiscussionChannel: {
      connect: { where: { node: { id: `dc-${channel}` } } },
    },
    GivesFeedbackOnDiscussion: {
      connect: { where: { node: { id: `disc-${channel}` } } },
    },
    CommentAuthor: {
      User: { connect: { where: { node: { username: ADMIN_USER } } } },
    },
  },
];

test("creating a feedback comment is blocked when the channel has feedback disabled", async () => {
  await seedFeedbackTarget("fb-off", false);

  const result = await exec(CREATE_COMMENTS, { input: feedbackCommentInput("fb-off") });

  assert.equal(firstErrorMessage(result), "Feedback is disabled in channel 'fb-off'.");
});

// --- channel downloadsEnabled ----------------------------------------------

const downloadDiscussionInput = (
  channel: string,
  extra: Record<string, unknown> = {}
) => [
  {
    discussionCreateInput: {
      title: "A download",
      hasDownload: true,
      ...extra,
    },
    channelConnections: [channel],
  },
];

test("creating a download is blocked when the channel has downloads disabled", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'dl-off', downloadsEnabled: false, createdAt: datetime() })`
  );

  const result = await exec(CREATE_DISCUSSION, {
    input: downloadDiscussionInput("dl-off"),
  });

  assert.equal(firstErrorMessage(result), "Downloads are disabled in channel 'dl-off'.");
});

// --- channel allowedFileTypes ----------------------------------------------

test("creating a download is blocked when the file type is not allowed in the channel", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'dl-typed', downloadsEnabled: true, allowedFileTypes: ['stl'], createdAt: datetime() })
     CREATE (:DownloadableFile { id: 'file-zip', fileName: 'archive.zip' })`
  );

  const result = await exec(CREATE_DISCUSSION, {
    input: downloadDiscussionInput("dl-typed", {
      DownloadableFiles: { connect: [{ where: { node: { id: "file-zip" } } }] },
    }),
  });

  assert.equal(
    firstErrorMessage(result),
    "File type 'zip' is not allowed in channel 'dl-typed'. Allowed types: stl"
  );
});

test("a download whose file type IS allowed in the channel passes the file-type gate", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'dl-ok', downloadsEnabled: true, allowedFileTypes: ['zip'], createdAt: datetime() })
     CREATE (:DownloadableFile { id: 'file-ok', fileName: 'archive.zip' })`
  );

  const result = await exec(CREATE_DISCUSSION, {
    input: downloadDiscussionInput("dl-ok", {
      Author: { connect: { where: { node: { username: ADMIN_USER } } } },
      DownloadableFiles: { connect: [{ where: { node: { id: "file-ok" } } }] },
    }),
  });

  // The download/file-type gate must NOT fire for an enabled channel + allowed
  // type. (We assert the gate is silent rather than full resolver success, so
  // the test stays robust to unrelated resolver/seed details.)
  const message = firstErrorMessage(result) ?? "";
  assert.ok(
    !/disabled in channel|is not allowed in channel/.test(message),
    `download gate should not block an allowed file type, got: ${message}`
  );
});

// --- imageUploadsEnabled ----------------------------------------------------

test("creating a discussion with an image is blocked when image uploads are disabled", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'img-off', imageUploadsEnabled: false, createdAt: datetime() })`
  );

  const result = await exec(CREATE_DISCUSSION, {
    input: [
      {
        discussionCreateInput: {
          title: "Has an image",
          Album: {
            create: {
              node: {
                Images: { connect: [{ where: { node: { id: "image-1" } } }] },
              },
            },
          },
        },
        channelConnections: ["img-off"],
      },
    ],
  });

  assert.equal(firstErrorMessage(result), "Image uploads are disabled in channel 'img-off'.");
});

import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import {
  resetDb,
  run,
  startImageModEnv,
  stopImageModEnv,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;

before(
  async () => {
    env = await startImageModEnv();
  },
  { timeout: 240000 }
);

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  await run(`CREATE (:User {username: 'poster'})`);
});

const discussionInput = (
  title: string,
  channelConnections: string[],
  channelFlairSelections: Array<{
    channelUniqueName: string;
    flairIds: string[];
  }> = []
) => ({
  discussionCreateInput: {
    title,
    Author: {
      connect: { where: { node: { username: "poster" } } },
    },
  },
  channelConnections,
  channelFlairSelections,
});

const createDiscussions = (input: ReturnType<typeof discussionInput>[]) =>
  env.resolvers.Mutation.createDiscussionWithChannelConnections(
    null,
    { input },
    { user: { username: "poster" } }
  );

test("assigns different active flairs to each channel submission", async () => {
  await run(
    `
      CREATE (cats:Channel {
        uniqueName: 'cats',
        discussionFlairRequired: true,
        createdAt: datetime()
      })
      CREATE (dogs:Channel {
        uniqueName: 'dogs',
        discussionFlairRequired: false,
        createdAt: datetime()
      })
      CREATE (question:DiscussionFlair {
        id: 'question',
        channelUniqueName: 'cats',
        displayName: 'Question',
        order: 0,
        archived: false
      })
      CREATE (help:DiscussionFlair {
        id: 'help',
        channelUniqueName: 'cats',
        displayName: 'Help',
        order: 1,
        archived: false
      })
      CREATE (showcase:DiscussionFlair {
        id: 'showcase',
        channelUniqueName: 'dogs',
        displayName: 'Showcase',
        order: 0,
        archived: false
      })
      CREATE (cats)-[:HAS_DISCUSSION_FLAIR]->(question)
      CREATE (cats)-[:HAS_DISCUSSION_FLAIR]->(help)
      CREATE (dogs)-[:HAS_DISCUSSION_FLAIR]->(showcase)
    `
  );

  await createDiscussions([
    discussionInput("Flair assignments", ["cats", "dogs"], [
      { channelUniqueName: "cats", flairIds: ["question", "help"] },
      { channelUniqueName: "dogs", flairIds: ["showcase"] },
    ]),
  ]);

  const assignments = await run(
    `
      MATCH (dc:DiscussionChannel)-[:HAS_DISCUSSION_FLAIR]->(flair:DiscussionFlair)
      WITH dc, flair
      ORDER BY dc.channelUniqueName, flair.order
      RETURN dc.channelUniqueName AS channelUniqueName,
             collect(flair.id) AS flairIds
      ORDER BY channelUniqueName
    `
  );

  assert.deepEqual(assignments, [
    { channelUniqueName: "cats", flairIds: ["question", "help"] },
    { channelUniqueName: "dogs", flairIds: ["showcase"] },
  ]);
});

test("rejects a required channel before creating the discussion", async () => {
  await run(
    `
      CREATE (channel:Channel {
        uniqueName: 'required',
        discussionFlairRequired: true,
        createdAt: datetime()
      })
      CREATE (flair:DiscussionFlair {
        id: 'question',
        channelUniqueName: 'required',
        displayName: 'Question',
        order: 0,
        archived: false
      })
      CREATE (channel)-[:HAS_DISCUSSION_FLAIR]->(flair)
    `
  );

  await assert.rejects(
    () => createDiscussions([discussionInput("Missing flair", ["required"])]),
    /At least one flair is required for channel 'required'/
  );

  const [{ discussionCount }] = await run(
    `MATCH (discussion:Discussion) RETURN count(discussion) AS discussionCount`
  );
  assert.equal(Number(discussionCount), 0);
});

test("rejects archived and cross-channel flairs before creating the discussion", async () => {
  await run(
    `
      CREATE (cats:Channel {
        uniqueName: 'cats',
        discussionFlairRequired: false,
        createdAt: datetime()
      })
      CREATE (dogs:Channel {
        uniqueName: 'dogs',
        discussionFlairRequired: false,
        createdAt: datetime()
      })
      CREATE (archived:DiscussionFlair {
        id: 'archived',
        channelUniqueName: 'cats',
        displayName: 'Archived',
        order: 0,
        archived: true
      })
      CREATE (foreign:DiscussionFlair {
        id: 'foreign',
        channelUniqueName: 'dogs',
        displayName: 'Foreign',
        order: 0,
        archived: false
      })
      CREATE (cats)-[:HAS_DISCUSSION_FLAIR]->(archived)
      CREATE (dogs)-[:HAS_DISCUSSION_FLAIR]->(foreign)
    `
  );

  for (const flairId of ["archived", "foreign"]) {
    await assert.rejects(
      () =>
        createDiscussions([
          discussionInput("Invalid flair", ["cats"], [
            { channelUniqueName: "cats", flairIds: [flairId] },
          ]),
        ]),
      new RegExp(`Flair '${flairId}' is not active in channel 'cats'`)
    );
  }

  const [{ discussionCount }] = await run(
    `MATCH (discussion:Discussion) RETURN count(discussion) AS discussionCount`
  );
  assert.equal(Number(discussionCount), 0);
});

test("enforces and assigns flairs when adding a discussion to a channel", async () => {
  await run(
    `
      CREATE (discussion:Discussion {
        id: 'existing-discussion',
        title: 'Existing discussion',
        hasSpoiler: false,
        createdAt: datetime()
      })
      CREATE (channel:Channel {
        uniqueName: 'required',
        discussionFlairRequired: true,
        createdAt: datetime()
      })
      CREATE (flair:DiscussionFlair {
        id: 'question',
        channelUniqueName: 'required',
        displayName: 'Question',
        order: 0,
        archived: false
      })
      CREATE (channel)-[:HAS_DISCUSSION_FLAIR]->(flair)
    `
  );

  await env.resolvers.Mutation.updateDiscussionWithChannelConnections(
    null,
    {
      where: { id: "existing-discussion" },
      discussionUpdateInput: { hasSpoiler: true },
      channelConnections: ["required"],
      channelFlairSelections: [
        { channelUniqueName: "required", flairIds: ["question"] },
      ],
    },
    { user: { username: "poster" } }
  );

  const assignments = await run(
    `
      MATCH (discussion:Discussion {id: 'existing-discussion'})
        <-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
        -[:HAS_DISCUSSION_FLAIR]->(flair:DiscussionFlair)
      RETURN discussion.hasSpoiler AS hasSpoiler,
             dc.channelUniqueName AS channelUniqueName,
             flair.id AS flairId
    `
  );
  assert.deepEqual(assignments, [
    {
      hasSpoiler: true,
      channelUniqueName: "required",
      flairId: "question",
    },
  ]);
});

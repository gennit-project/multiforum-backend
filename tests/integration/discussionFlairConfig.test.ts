import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import type { Driver } from "neo4j-driver";
import { getChannelDiscussionFlairConfig } from "../../customResolvers/queries/getChannelDiscussionFlairConfig.js";
import { setChannelDiscussionFlairConfig } from "../../customResolvers/mutations/setChannelDiscussionFlairConfig.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

let driver: Driver;

before(
  async () => {
    driver = await startNeo4j();
  },
  { timeout: 240000 }
);

after(async () => {
  await stopNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);
  const session = driver.session();
  try {
    await session.run(
      `CREATE (:Channel {
        uniqueName: 'gardening',
        displayName: 'Gardening',
        discussionFlairRequired: false
      })`
    );
  } finally {
    await session.close();
  }
});

const context = {
  user: { username: "channel-owner" },
} as GraphQLContext;

test("persists, reads, and archives channel discussion flairs", async () => {
  const setConfig = setChannelDiscussionFlairConfig({
    driver,
    createId: (() => {
      const ids = ["question", "showcase"];
      return () => ids.shift() as string;
    })(),
  });
  const getConfig = getChannelDiscussionFlairConfig({ driver });

  await setConfig(
    null,
    {
      channelUniqueName: "gardening",
      flairRequired: true,
      flairs: [
        {
          displayName: "Question",
          color: "#2563EB",
          order: 0,
          archived: false,
        },
        {
          displayName: "Showcase",
          color: "#16A34A",
          order: 1,
          archived: false,
        },
      ],
    },
    context
  );

  assert.deepEqual(await getConfig(null, { channelUniqueName: "gardening" }), {
    channelUniqueName: "gardening",
    flairRequired: true,
    flairs: [
      {
        id: "question",
        channelUniqueName: "gardening",
        displayName: "Question",
        color: "#2563EB",
        order: 0,
        archived: false,
      },
      {
        id: "showcase",
        channelUniqueName: "gardening",
        displayName: "Showcase",
        color: "#16A34A",
        order: 1,
        archived: false,
      },
    ],
  });

  await setConfig(
    null,
    {
      channelUniqueName: "gardening",
      flairRequired: true,
      flairs: [
        {
          id: "question",
          displayName: "Help",
          color: "#DC2626",
          order: 0,
          archived: false,
        },
      ],
    },
    context
  );

  const activeConfig = await getConfig(null, {
    channelUniqueName: "gardening",
  });
  assert.deepEqual(
    activeConfig.flairs.map((flair) => flair.id),
    ["question"]
  );

  const managementConfig = await getConfig(null, {
    channelUniqueName: "gardening",
    includeArchived: true,
  });
  assert.deepEqual(
    managementConfig.flairs.map((flair) => [flair.id, flair.archived]),
    [
      ["question", false],
      ["showcase", true],
    ]
  );

  const session = driver.session();
  try {
    await session.run(
      `
        MATCH (:Channel {uniqueName: 'gardening'})
          -[:HAS_DISCUSSION_FLAIR]->(flair:DiscussionFlair)
        SET flair.archived = true
      `
    );
  } finally {
    await session.close();
  }

  const archivedOnlyConfig = await getConfig(null, {
    channelUniqueName: "gardening",
  });
  assert.deepEqual(archivedOnlyConfig.flairs, []);
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createCommentCreationAuthorizationRepository } from "../../services/persistence/commentCreationAuthorizationRepository.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = await startNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);
});

after(async () => {
  await stopNeo4j();
});

test("reads comment-creation target state by its authorization keys", async () => {
  await driver.executeQuery(`
    CREATE (:Comment {id: "comment-open", archived: false})
    CREATE (:Comment {id: "comment-archived", archived: true})
    CREATE (:DiscussionChannel {
      id: "discussion-open",
      channelUniqueName: "cats",
      locked: false,
      archived: false
    })
    CREATE (:DiscussionChannel {
      id: "discussion-locked",
      channelUniqueName: "cats",
      locked: true,
      archived: false
    })
    CREATE (:DiscussionChannel {
      id: "discussion-orphan",
      locked: false,
      archived: false
    })
    CREATE (:EventChannel {
      id: "event-channel-cats",
      eventId: "event-1",
      channelUniqueName: "cats",
      locked: false,
      archived: false
    })
    CREATE (:EventChannel {
      id: "event-channel-dogs",
      eventId: "event-1",
      channelUniqueName: "dogs",
      locked: false,
      archived: true
    })
  `);
  const repository = createCommentCreationAuthorizationRepository(
    driver,
    "neo4j"
  );

  assert.deepEqual(await repository.findParentCommentState("comment-open"), {
    found: true,
    archived: false,
  });
  assert.deepEqual(
    await repository.findParentCommentState("comment-archived"),
    { found: true, archived: true }
  );
  assert.deepEqual(await repository.findParentCommentState("missing"), {
    found: false,
    archived: null,
  });

  assert.deepEqual(
    await repository.findDiscussionChannelState("discussion-open"),
    {
      found: true,
      channelUniqueName: "cats",
      locked: false,
      archived: false,
    }
  );
  assert.deepEqual(
    await repository.findDiscussionChannelState("discussion-locked"),
    {
      found: true,
      channelUniqueName: "cats",
      locked: true,
      archived: false,
    }
  );
  assert.deepEqual(
    await repository.findDiscussionChannelState("discussion-orphan"),
    {
      found: true,
      channelUniqueName: null,
      locked: false,
      archived: false,
    }
  );
  assert.deepEqual(
    await repository.findDiscussionChannelState("missing"),
    {
      found: false,
      channelUniqueName: null,
      locked: null,
      archived: null,
    }
  );

  assert.deepEqual(
    await repository.findEventChannelState("event-1", "cats"),
    { found: true, locked: false, archived: false }
  );
  assert.deepEqual(
    await repository.findEventChannelState("event-1", "dogs"),
    { found: true, locked: false, archived: true }
  );
  assert.deepEqual(
    await repository.findEventChannelState("event-1", "missing"),
    { found: false, locked: null, archived: null }
  );
});

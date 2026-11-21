import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDiscussionIdByNumber,
  resolveDiscussionIdArg,
  resolveDiscussionIdArgWithDriver,
} from "./discussionRouteLookup.js";
import { resolveEventIdByNumber } from "./eventRouteLookup.js";
import { resolveCommentIdByShortId, COMMENT_SHORT_ID_CYPHER } from "./commentShortId.js";

const runner = (id: string | null) => ({
  run: async () => ({ records: id === null ? [] : [{ get: () => id }] }),
});

const driverFor = (id: string | null) => {
  let closed = 0;
  return {
    get closed() {
      return closed;
    },
    driver: {
      session: () => ({ run: runner(id).run, close: async () => { closed += 1; } }),
    } as any,
  };
};

test("resolveDiscussionIdByNumber / resolveEventIdByNumber return id or null", async () => {
  assert.equal(await resolveDiscussionIdByNumber(runner("d-1"), "cats", 42), "d-1");
  assert.equal(await resolveDiscussionIdByNumber(runner(null), "cats", 99), null);
  assert.equal(await resolveEventIdByNumber(runner("e-1"), "cats", 7), "e-1");
});

test("resolveDiscussionIdArg prefers an explicit id, then the number, else null", async () => {
  assert.equal(await resolveDiscussionIdArg(runner("ignored"), { channelUniqueName: "cats", discussionId: "d-explicit" }), "d-explicit");
  assert.equal(await resolveDiscussionIdArg(runner("d-from-number"), { channelUniqueName: "cats", discussionNumber: 42 }), "d-from-number");
  assert.equal(await resolveDiscussionIdArg(runner("x"), { channelUniqueName: "cats" }), null);
});

test("resolveDiscussionIdArgWithDriver short-circuits on an explicit id and opens a session only for a number", async () => {
  const withId = driverFor("unused");
  assert.equal(await resolveDiscussionIdArgWithDriver(withId.driver, { channelUniqueName: "cats", discussionId: "d-1" }), "d-1");
  assert.equal(withId.closed, 0);

  const withNumber = driverFor("d-2");
  assert.equal(await resolveDiscussionIdArgWithDriver(withNumber.driver, { channelUniqueName: "cats", discussionNumber: 2 }), "d-2");
  assert.equal(withNumber.closed, 1);

  assert.equal(await resolveDiscussionIdArgWithDriver(driverFor("x").driver, { channelUniqueName: "cats" }), null);
});

test("resolveCommentIdByShortId returns the id or null and the shortId cypher is hex-truncating", async () => {
  assert.equal(await resolveCommentIdByShortId(runner("c-1"), "abc123abc123"), "c-1");
  assert.equal(await resolveCommentIdByShortId(runner(null), "nope00000000"), null);
  assert.match(COMMENT_SHORT_ID_CYPHER, /substring\(replace\(randomUUID\(\), '-', ''\), 0, 12\)/);
});

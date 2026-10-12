import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  assertReplyRelationship,
  MAX_REPLY_DEPTH,
  REPLY_ANCESTRY_ERROR_CODE,
} from "./replyAncestry.js";

type Snapshot = {
  parentDepth?: unknown;
  parentHasCycle?: boolean;
  parentExceedsMaxDepth?: boolean;
  ancestryHasMultipleParents?: boolean;
  wouldCreateCycle?: boolean;
  currentParentIds?: string[];
};

const buildDriver = (snapshot: Snapshot | null) => {
  let closed = false;
  let query = "";
  const values = {
    parentDepth: snapshot?.parentDepth ?? 0,
    parentHasCycle: snapshot?.parentHasCycle ?? false,
    parentExceedsMaxDepth: snapshot?.parentExceedsMaxDepth ?? false,
    ancestryHasMultipleParents: snapshot?.ancestryHasMultipleParents ?? false,
    wouldCreateCycle: snapshot?.wouldCreateCycle ?? false,
    currentParentIds: snapshot?.currentParentIds ?? [],
  };
  const driver = {
    session: () => ({
      executeRead: async (work: (tx: { run: (text: string) => Promise<unknown> }) => Promise<unknown>) =>
        work({
          run: async (text: string) => {
            query = text;
            return {
              records: snapshot === null
                ? []
                : [{ get: (key: keyof typeof values) => values[key] }],
            };
          },
        }),
      close: async () => {
        closed = true;
      },
    }),
  } as unknown as Driver;
  return { driver, query: () => query, closed: () => closed };
};

const rejectsWith = async (
  snapshot: Snapshot | null,
  expected: RegExp,
  input: Partial<Parameters<typeof assertReplyRelationship>[0]> = {}
) => {
  const mock = buildDriver(snapshot);
  await assert.rejects(
    assertReplyRelationship({
      driver: mock.driver,
      parentCommentId: "parent",
      childCommentId: "child",
      ...input,
    }),
    (error: unknown) => {
      assert.match((error as Error).message, expected);
      assert.equal(
        (error as { extensions?: { code?: string } }).extensions?.code,
        REPLY_ANCESTRY_ERROR_CODE
      );
      return true;
    }
  );
  assert.equal(mock.closed(), true);
};

test("accepts a valid reply and uses only bounded ancestry traversals", async () => {
  const mock = buildDriver({ parentDepth: MAX_REPLY_DEPTH - 1 });
  await assertReplyRelationship({
    driver: mock.driver,
    parentCommentId: "parent",
    childCommentId: "child",
  });
  assert.equal(mock.closed(), true);
  assert.match(mock.query(), new RegExp(`IS_REPLY_TO\\*0\\.\\.${MAX_REPLY_DEPTH}`));
  assert.doesNotMatch(mock.query(), /IS_REPLY_TO\*\d*\.\.\]/);
});

test("rejects a missing parent", () =>
  rejectsWith(null, /Could not find/));

test("rejects an empty parent ID before opening a session", async () => {
  const mock = buildDriver({});
  await assert.rejects(
    assertReplyRelationship({
      driver: mock.driver,
      parentCommentId: "",
    }),
    /parent ID is required/
  );
  assert.equal(mock.closed(), false);
});

test("rejects self replies before opening a session", async () => {
  const mock = buildDriver({});
  await assert.rejects(
    assertReplyRelationship({
      driver: mock.driver,
      parentCommentId: "same",
      childCommentId: "same",
    }),
    /cannot reply to itself/
  );
  assert.equal(mock.closed(), false);
});

test("rejects a reply beyond the maximum depth", () =>
  rejectsWith({ parentDepth: MAX_REPLY_DEPTH }, /more than 32 levels/));

test("handles Neo4j Integer depth values", async () => {
  const mock = buildDriver({ parentDepth: neo4j.int(MAX_REPLY_DEPTH - 1) });
  await assert.doesNotReject(assertReplyRelationship({
    driver: mock.driver,
    parentCommentId: "parent",
  }));
  assert.equal(mock.closed(), true);
});

test("rejects a parent chain with a cycle", () =>
  rejectsWith({ parentHasCycle: true }, /invalid ancestry chain/));

test("rejects an existing over-depth parent chain", () =>
  rejectsWith({ parentExceedsMaxDepth: true }, /invalid ancestry chain/));

test("rejects malformed ancestry with multiple parents", () =>
  rejectsWith({ ancestryHasMultipleParents: true }, /thread with multiple parents/));

test("rejects a proposed indirect cycle", () =>
  rejectsWith({ wouldCreateCycle: true }, /would create a cycle/));

test("rejects a child that already has multiple parents", () =>
  rejectsWith({ currentParentIds: ["one", "two"] }, /multiple reply parents/));

test("requires an explicit replacement when the child already has another parent", () =>
  rejectsWith({ currentParentIds: ["old-parent"] }, /disconnect or overwrite/));

test("allows an explicit parent replacement", async () => {
  const mock = buildDriver({ currentParentIds: ["old-parent"] });
  await assertReplyRelationship({
    driver: mock.driver,
    parentCommentId: "new-parent",
    childCommentId: "child",
    allowParentReplacement: true,
  });
  assert.equal(mock.closed(), true);
});

test("allows reconnecting the child's existing parent without overwrite", async () => {
  const mock = buildDriver({ currentParentIds: ["same-parent"] });
  await assertReplyRelationship({
    driver: mock.driver,
    parentCommentId: "same-parent",
    childCommentId: "child",
  });
  assert.equal(mock.closed(), true);
});

test("closes the session when the ancestry query fails", async () => {
  let closed = false;
  const driver = {
    session: () => ({
      executeRead: async () => {
        throw new Error("database unavailable");
      },
      close: async () => {
        closed = true;
      },
    }),
  } as unknown as Driver;

  await assert.rejects(assertReplyRelationship({
    driver,
    parentCommentId: "parent",
  }), /database unavailable/);
  assert.equal(closed, true);
});

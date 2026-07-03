import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import {
  addToCollection,
  removeFromCollection,
  reorderCollectionItem,
} from "./collectionOrdering.js";

const buildDriver = ({ records = [{}] }: { records?: unknown[] } = {}) => {
  const calls = {
    run: [] as Array<[string, Record<string, unknown>]>,
    close: 0,
  };

  const driver = {
    session: () => ({
      run: async (query: string, params: Record<string, unknown>) => {
        calls.run.push([query, params]);
        return {
          records: records.map((record) => ({
            get: () => record,
          })),
        };
      },
      close: async () => {
        calls.close += 1;
      },
    }),
  };

  return { driver: driver as unknown as Driver, calls };
};

const context = { user: { username: "alice" } } as unknown as GraphQLContext;

test("addToCollection owner-checks and inserts the item at the requested position", async () => {
  const { driver, calls } = buildDriver();
  const resolver = addToCollection({ driver });

  const result = await resolver(
    null,
    {
      input: {
        collectionId: "collection-1",
        itemId: "discussion-1",
        itemType: "DISCUSSION",
        position: 1,
      },
    },
    context
  );

  assert.equal(result, true);
  assert.match(calls.run[0][0], /CREATED_BY/);
  assert.match(calls.run[0][0], /CONTAINS_DISCUSSION/);
  assert.match(calls.run[0][0], /existingOrder WHERE id <> \$itemId/);
  assert.equal(calls.run[0][1].username, "alice");
  assert.equal(calls.run[0][1].position, 1);
  assert.equal(calls.close, 1);
});

test("addToCollection appends channels by uniqueName", async () => {
  const { driver, calls } = buildDriver();
  const resolver = addToCollection({ driver });

  await resolver(
    null,
    {
      input: {
        collectionId: "collection-1",
        itemId: "sims4_builds",
        itemType: "CHANNEL",
      },
    },
    context
  );

  assert.match(calls.run[0][0], /item:Channel \{uniqueName: \$itemId\}/);
  assert.equal(calls.run[0][1].position, null);
});

test("removeFromCollection removes the relationship and prunes stale order entries", async () => {
  const { driver, calls } = buildDriver();
  const resolver = removeFromCollection({ driver });

  const result = await resolver(
    null,
    {
      collectionId: "collection-1",
      itemId: "image-1",
      itemType: "IMAGE",
    },
    context
  );

  assert.equal(result, true);
  assert.match(calls.run[0][0], /CONTAINS_IMAGE/);
  assert.match(calls.run[0][0], /WHERE id <> \$itemId/);
});

test("reorderCollectionItem normalizes stored order and clamps the target position", async () => {
  const { driver, calls } = buildDriver();
  const resolver = reorderCollectionItem({ driver });

  const result = await resolver(
    null,
    {
      collectionId: "collection-1",
      itemId: "discussion-2",
      newPosition: -10,
    },
    context
  );

  assert.equal(result, true);
  assert.match(calls.run[0][0], /CONTAINS_DISCUSSION\|CONTAINS_COMMENT\|CONTAINS_DOWNLOAD\|CONTAINS_IMAGE\|CONTAINS_CHANNEL/);
  assert.match(calls.run[0][0], /WHERE \$itemId IN itemIds/);
  assert.match(calls.run[0][0], /WHEN \$newPosition < 0 THEN 0/);
});

test("collection mutations reject missing ownership or missing items", async () => {
  const { driver } = buildDriver({ records: [] });
  const resolver = reorderCollectionItem({ driver });

  await assert.rejects(
    resolver(
      null,
      {
        collectionId: "collection-1",
        itemId: "missing",
        newPosition: 0,
      },
      context
    ),
    /Item is not in this collection/
  );
});

test("collection mutations require a logged-in user", async () => {
  const { driver } = buildDriver();
  const resolver = addToCollection({ driver });

  await assert.rejects(
    resolver(
      null,
      {
        input: {
          collectionId: "collection-1",
          itemId: "discussion-1",
          itemType: "DISCUSSION",
        },
      },
      {} as GraphQLContext
    ),
    /logged in/
  );
});

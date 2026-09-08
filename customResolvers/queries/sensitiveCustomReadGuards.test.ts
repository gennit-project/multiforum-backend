import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import getCommentSection from "./getCommentSection.js";
import getCommentReplies from "./getCommentReplies.js";
import getUserFavoriteComment from "./getUserFavoriteComment.js";
import getImageAlbumUsage from "./getImageAlbumUsage.js";

const sensitiveDriver = () => {
  let runCount = 0;
  const driver = {
    session: () => ({
      run: async () => {
        runCount += 1;
        return { records: [{ get: (key: string) => key === "sensitive" }] };
      },
      close: async () => {},
    }),
  } as unknown as Driver;
  return { driver, runs: () => runCount };
};

const blockedContext = (driver: Driver) => ({
  driver,
  mayAccessSensitiveContent: false,
  user: { username: "minor", email: null, email_verified: true, data: null },
}) as GraphQLContext;

test("comment sections return an empty not-found shape for a sensitive discussion", async () => {
  const { driver, runs } = sensitiveDriver();
  const resolver = getCommentSection({
    driver,
    DiscussionChannel: {
      find: async () => { throw new Error("content lookup must not run"); },
    },
  } as any);

  const result = await resolver(null, {
    channelUniqueName: "general",
    discussionId: "sensitive-discussion",
    modName: "",
    offset: "0",
    limit: "10",
    sort: "new",
  }, blockedContext(driver), null as any);

  assert.deepEqual(result, { DiscussionChannel: null, Comments: [] });
  assert.equal(runs(), 1);
});

test("comment reply lists return empty before aggregate or content queries", async () => {
  const { driver, runs } = sensitiveDriver();
  const resolver = getCommentReplies({
    driver,
    Comment: {
      aggregate: async () => { throw new Error("aggregate must not run"); },
    },
  } as any);

  const result = await resolver(null, {
    commentId: "sensitive-comment",
    modName: "",
    offset: "0",
    limit: "10",
    sort: "new",
  }, blockedContext(driver), null as any);

  assert.deepEqual(result, { ChildComments: [], aggregateChildCommentCount: 0 });
  assert.equal(runs(), 1);
});

test("favorite status does not reveal a sensitive comment", async () => {
  const { driver, runs } = sensitiveDriver();
  const resolver = getUserFavoriteComment({ driver });

  const result = await resolver(
    null,
    { commentId: "sensitive-comment" },
    blockedContext(driver),
    null as any
  );

  assert.equal(result, false);
  assert.equal(runs(), 1);
});

test("image album usage reports a forbidden sensitive image as not found", async () => {
  const { driver, runs } = sensitiveDriver();
  const resolver = getImageAlbumUsage({ driver });

  await assert.rejects(
    resolver(null, { imageId: "sensitive-image" }, blockedContext(driver)),
    /Image not found/
  );
  assert.equal(runs(), 1);
});

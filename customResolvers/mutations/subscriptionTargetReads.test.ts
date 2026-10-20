import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import type { SubscriptionTargetRepository } from "../../services/persistence/subscriptionTargetRepository.js";
import subscribeToComment from "./subscribeToComment.js";
import unsubscribeFromComment from "./unsubscribeFromComment.js";
import subscribeToDiscussionChannel from "./subscribeToDiscussionChannel.js";
import unsubscribeFromDiscussionChannel from "./unsubscribeFromDiscussionChannel.js";
import subscribeToEvent from "./subscribeToEvent.js";
import unsubscribeFromEvent from "./unsubscribeFromEvent.js";
import subscribeToEventUpdates from "./subscribeToEventUpdates.js";
import unsubscribeFromEventUpdates from "./unsubscribeFromEventUpdates.js";
import subscribeToIssue from "./subscribeToIssue.js";
import unsubscribeFromIssue from "./unsubscribeFromIssue.js";

const factories = { subscribeToComment, unsubscribeFromComment,
  subscribeToDiscussionChannel, unsubscribeFromDiscussionChannel,
  subscribeToEvent, unsubscribeFromEvent, subscribeToEventUpdates,
  unsubscribeFromEventUpdates, subscribeToIssue, unsubscribeFromIssue };
const context = { user: { username: "actor" } } as GraphQLContext;
const args = { commentId: "target", discussionChannelId: "target", eventId: "target", issueId: "target" };
for (const [name, factory] of Object.entries(factories)) {
  const setup = (failure?: "write" | "read", absent = false) => {
    const order: string[] = [];
    const queries: string[] = [];
    const driver = { session(config: unknown) {
      assert.equal(config, undefined); // Existing write session/routing unchanged.
      order.push("open-write");
      return { async run(query: string) {
        order.push("write"); queries.push(query);
        if (failure === "write") throw new Error("write failed");
        return { records: [] };
      }, close() { order.push("close-write"); return Promise.resolve(); } };
    } } as unknown as Driver;
    const snapshot = { id: "target", createdAt: "2026-10-20T00:00:00.000Z", SubscribedToNotifications: [] };
    const read = async (id: string) => {
      assert.equal(id, "target"); order.push("read");
      if (failure === "read") throw new Error("read failed");
      return absent ? [] : [snapshot];
    };
    const repository: SubscriptionTargetRepository = { findComment: read, findDiscussionChannel: read,
      findEvent: read, findEventUpdates: read, findIssue: read };
    return { resolver: factory({ driver, subscriptionTargetRepository: repository }), order, queries, snapshot };
  };
  test(`${name} retains raw write-before-read and returns the first snapshot`, async () => {
    const state = setup();
    assert.equal(await state.resolver(null, args, context, {} as GraphQLResolveInfo), state.snapshot);
    assert.deepEqual(state.order, ["open-write", "write", "read", "close-write"]);
    assert.match(state.queries[0], name.startsWith("unsubscribe") ? /DELETE r/ : /MERGE/);
    const relation = name.endsWith("Issue") ? "SUBSCRIBED_TO_ISSUE" : name.endsWith("EventUpdates") ? "SUBSCRIBED_TO_EVENT_UPDATES" : "SUBSCRIBED_TO_NOTIFICATIONS";
    assert.ok(state.queries[0].includes(relation));
    const missing = setup(undefined, true);
    assert.equal(await missing.resolver(null, args, context, {} as GraphQLResolveInfo), undefined);
  });
  test(`${name} keeps authentication and write/read failure boundaries`, async () => {
    const unauthorized = setup();
    await assert.rejects(unauthorized.resolver(null, args, { user: {} } as GraphQLContext, {} as GraphQLResolveInfo), { message: "Authentication required" });
    assert.deepEqual(unauthorized.order, []);
    for (const failure of ["write", "read"] as const) {
      const state = setup(failure);
      await assert.rejects(state.resolver(null, args, context, {} as GraphQLResolveInfo), new RegExp(`Failed to .*: ${failure} failed`));
      assert.deepEqual(state.order, failure === "write" ? ["open-write", "write", "close-write"] : ["open-write", "write", "read", "close-write"]);
    }
  });
}

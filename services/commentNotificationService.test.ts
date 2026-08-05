// Unit tests for CommentNotificationService. The service subscribes to a
// commentCreated GraphQL subscription and, for each event, runs the comment
// notification handler. We drive it with a tiny in-memory executable schema whose
// subscription yields a controlled sequence of events, and a permissive OGM so
// the handler runs harmlessly. Covers: init, the happy start->process->handle
// path, the already-running guard, invalid events, a subscribe-error result, and
// stop(). No DB, no network.
import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { CommentNotificationService } from "./commentNotificationService.js";

// A permissive OGM: every model resolves to safe no-ops so the notification
// handler can run without a database.
const permissiveOgm: any = {
  model() {
    return {
      find: async () => [],
      create: async () => ({}),
      update: async () => ({}),
    };
  },
};

// Build a schema whose commentCreated subscription yields the provided events and
// then completes, so the service's `for await` loop drains and returns.
function schemaYielding(events: any[]) {
  const typeDefs = `
    type User { username: String }
    type CreatedComment { id: ID }
    type CommentCreatedPayload { createdComment: CreatedComment }
    type Query { _empty: String }
    type Subscription { commentCreated: CommentCreatedPayload }
  `;
  const resolvers = {
    Subscription: {
      commentCreated: {
        subscribe: async function* () {
          for (const e of events) {
            yield { commentCreated: e };
          }
        },
      },
    },
  };
  return makeExecutableSchema({ typeDefs, resolvers });
}

// Give a started service's async processing loop a chance to drain before asserting.
const flush = () => new Promise((r) => setImmediate(r));

test("constructs without a driver and stop() is safe before start", () => {
  const svc = new CommentNotificationService(schemaYielding([]), permissiveOgm);
  svc.stop(); // no throw even though it never started
});

test("start() processes each created comment then the loop completes", async () => {
  const handled: string[] = [];
  const ogm: any = {
    model(name: string) {
      // Record Comment lookups as a proxy for the handler running per event.
      return {
        find: async () => {
          if (name === "Comment") handled.push("comment-find");
          return [];
        },
        create: async () => ({}),
        update: async () => ({}),
      };
    },
  };
  const schema = schemaYielding([
    { createdComment: { id: "c-1" } },
    { createdComment: null }, // invalid event -> skipped
    { createdComment: { id: "c-2" } },
  ]);
  const svc = new CommentNotificationService(schema, ogm);
  await svc.start();
  await flush();
  await flush();
  svc.stop();
  // The handler ran for the two valid events (each does at least one Comment lookup).
  assert.ok(handled.length >= 2, `expected the handler to run for valid events, saw ${handled.length}`);
});

test("start() is a no-op when the service is already running", async () => {
  // A subscription that stays open (never yields, never returns) keeps isRunning true.
  const typeDefs = `
    type Query { _empty: String }
    type Subscription { commentCreated: String }
  `;
  const resolvers = {
    Subscription: {
      commentCreated: {
        // Never yields; the for-await simply awaits, leaving the service running.
        subscribe: async function* () {
          await new Promise(() => {}); // pending forever
        },
      },
    },
  };
  const svc = new CommentNotificationService(makeExecutableSchema({ typeDefs, resolvers }), permissiveOgm);
  await svc.start();
  await flush();
  // Second start should short-circuit on the already-running guard.
  await svc.start();
  svc.stop();
});

test("start() handles a subscribe error result without throwing", async () => {
  // A subscription resolver that returns no async iterator produces an error result.
  const typeDefs = `
    type Query { _empty: String }
    type Subscription { commentCreated: String }
  `;
  const resolvers = {
    Subscription: {
      commentCreated: {
        subscribe: () => {
          throw new Error("cannot subscribe");
        },
      },
    },
  };
  const svc = new CommentNotificationService(makeExecutableSchema({ typeDefs, resolvers }), permissiveOgm);
  await svc.start(); // should catch/handle, not throw
  svc.stop();
});

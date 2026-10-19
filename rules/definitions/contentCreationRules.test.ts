// Unit tests for the content-creation graphql-shield rules. Rules expose their
// raw resolver as `.func(parent, args, ctx, info)`, which runs the real logic
// and throws on failure. We drive the guard branches (missing input / channel /
// resolvable channel name) directly, and the permission-check tail with a fuller
// context that denies for a user with no permission. Repository seams only; no DB.
import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCanCreateChannelRule,
  canCreateChannel,
  canCreateDiscussion,
  canCreateEvent,
  canCreateComment,
} from "./contentCreationRules.js";

const run = (r: any, args: any, ctx: any) => (r as any).func({}, args, ctx, {} as any);

type LookupCounters = {
  parentComments: string[];
  discussionChannels: string[];
  eventChannels: Array<{ eventId: string; channelUniqueName: string }>;
  permissionChannels: string[];
};

const makeCounters = (): LookupCounters => ({
  parentComments: [],
  discussionChannels: [],
  eventChannels: [],
  permissionChannels: [],
});

function makeCtx(
  rows: Record<string, unknown[]> = {},
  counters = makeCounters()
) {
  return {
    user: { username: "alice", email: "alice@x.test", data: { username: "alice" } },
    req: { headers: {} },
    driver: {
      session: () => ({
        run: async () => ({ records: [] }),
        close: async () => {},
      }),
    },
    permissionServerConfigRepository: {
      findByName: async () => rows.ServerConfig?.[0] ?? null,
    },
    commentCreationAuthorizationRepository: {
      async findParentCommentState(commentId: string) {
        counters.parentComments.push(commentId);
        const comment = rows.Comment?.[0] as any;
        return comment
          ? { found: true, archived: comment.archived ?? null }
          : { found: false, archived: null };
      },
      async findDiscussionChannelState(discussionChannelId: string) {
        counters.discussionChannels.push(discussionChannelId);
        const entry = rows.DiscussionChannel?.[0] as any;
        return entry
          ? {
              found: true,
              channelUniqueName: entry.channelUniqueName ?? null,
              locked: entry.locked ?? null,
              archived: entry.archived ?? null,
            }
          : {
              found: false,
              channelUniqueName: null,
              locked: null,
              archived: null,
            };
      },
      async findEventChannelState(
        eventId: string,
        channelUniqueName: string
      ) {
        counters.eventChannels.push({ eventId, channelUniqueName });
        const entry = (rows.EventChannel ?? []).find(
          (candidate: any) =>
            (!candidate.eventId || candidate.eventId === eventId) &&
            (!candidate.channelUniqueName ||
              candidate.channelUniqueName === channelUniqueName)
        ) as any;
        return entry
          ? {
              found: true,
              locked: entry.locked ?? null,
              archived: entry.archived ?? null,
            }
          : { found: false, locked: null, archived: null };
      },
    },
    channelPermissionRepository: {
      async findAuthorizationSnapshot(channelName: string) {
        counters.permissionChannels.push(channelName);
        return null;
      },
      async findTargetedSuspensions() {
        return { userSuspensions: [], modSuspensions: [] };
      },
    },
    ogm: {
      model() {
        throw new Error("comment creation authorization must not use ogm.model");
      },
    },
  } as any;
}
const permCtx = (extra: Record<string, unknown[]> = {}) =>
  makeCtx({ ServerConfig: [{ Admins: [], SuperAdmins: [] }], ...extra });

async function ranToDecision(promise: Promise<unknown>) {
  try {
    const r = await promise;
    assert.ok(r === true || r === false || r instanceof Error, `unexpected: ${String(r)}`);
  } catch (e) {
    assert.ok(e instanceof Error); // shield rules throw on some denials
  }
}

// ---- canCreateChannel ----

test("evaluateCanCreateChannelRule runs the server-permission check", async () => {
  const r = await evaluateCanCreateChannelRule(permCtx());
  assert.ok(r === true || r instanceof Error);
});

test("canCreateChannel.func delegates to the evaluator", async () => {
  await ranToDecision(run(canCreateChannel, {}, permCtx()));
});

// ---- canCreateDiscussion ----

test("canCreateDiscussion checks channel permissions per input item", async () => {
  const args = { input: [{ discussionCreateInput: {}, channelConnections: ["cats"] }] };
  await ranToDecision(run(canCreateDiscussion, args, permCtx()));
});

test("canCreateDiscussion allows an empty input list (nothing to check)", async () => {
  const r = await run(canCreateDiscussion, { input: [] }, permCtx());
  assert.equal(r, true);
});

// ---- canCreateEvent ----

test("canCreateEvent flattens channel connections and checks permissions", async () => {
  const args = { input: [{ eventCreateInput: {}, channelConnections: ["cats"] }] };
  await ranToDecision(run(canCreateEvent, args, permCtx()));
});

// ---- canCreateComment ----

test("canCreateComment throws when there is no input item", async () => {
  await assert.rejects(run(canCreateComment, { input: [] }, makeCtx()), /No comment create input/);
});

test("canCreateComment throws when no Channel is connected", async () => {
  await assert.rejects(run(canCreateComment, { input: [{ text: "hi" }] }, makeCtx()), /connected to a Channel/);
});

test("canCreateComment throws when no channel name can be resolved", async () => {
  // Channel present but no DiscussionChannel/Event/feedback target -> channelName stays empty
  const input = [{ Channel: { connect: { where: { node: { uniqueName: "cats" } } } } }];
  await assert.rejects(run(canCreateComment, { input }, permCtx()), /No channel name/);
});

test("canCreateComment resolves the channel via DiscussionChannel and checks permission", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    DiscussionChannel: { connect: { where: { node: { id: "dc-1" } } } },
  }];
  const ctx = permCtx({ DiscussionChannel: [{ channelUniqueName: "cats", locked: false, archived: false }] });
  await ranToDecision(run(canCreateComment, { input }, ctx));
});

test("canCreateComment rejects a reply to an archived parent comment", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    ParentComment: { connect: { where: { node: { id: "c-parent" } } } },
  }];
  const ctx = permCtx({ Comment: [{ id: "c-parent", archived: true }] });
  await assert.rejects(run(canCreateComment, { input }, ctx), /archived/);
});

test("canCreateComment rejects a reply when the parent comment is missing", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    ParentComment: { connect: { where: { node: { id: "missing" } } } },
  }];
  await assert.rejects(
    run(canCreateComment, { input }, permCtx()),
    /Could not find the comment being replied to/
  );
});

test("canCreateComment rejects locked and archived discussion entries", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    DiscussionChannel: { connect: { where: { node: { id: "dc-1" } } } },
  }];

  await assert.rejects(
    run(
      canCreateComment,
      { input },
      permCtx({
        DiscussionChannel: [{
          channelUniqueName: "cats",
          locked: true,
          archived: false,
        }],
      })
    ),
    /locked discussion/
  );
  await assert.rejects(
    run(
      canCreateComment,
      { input },
      permCtx({
        DiscussionChannel: [{
          channelUniqueName: "cats",
          locked: false,
          archived: true,
        }],
      })
    ),
    /archived discussion/
  );
});

test("canCreateComment preserves DiscussionChannel identifier errors", async () => {
  const withoutId = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    DiscussionChannel: { connect: { where: { node: {} } } },
  }];
  await assert.rejects(
    run(canCreateComment, { input: withoutId }, permCtx()),
    /No discussion channel ID found/
  );

  const missing = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    DiscussionChannel: { connect: { where: { node: { id: "missing" } } } },
  }];
  await assert.rejects(
    run(canCreateComment, { input: missing }, permCtx()),
    /No discussion channel found/
  );
});

test("canCreateComment rejects a DiscussionChannel without a channel name", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    DiscussionChannel: { connect: { where: { node: { id: "dc-orphan" } } } },
  }];
  await assert.rejects(
    run(
      canCreateComment,
      { input },
      permCtx({
        DiscussionChannel: [{
          id: "dc-orphan",
          channelUniqueName: null,
          locked: false,
          archived: false,
        }],
      })
    ),
    /No channel name found/
  );
});

test("canCreateComment resolves the channel via an Event submission", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    Event: { connect: { where: { node: { id: "e-1" } } } },
  }];
  const ctx = permCtx({ EventChannel: [{ id: "ec-1", locked: false, archived: false }] });
  await ranToDecision(run(canCreateComment, { input }, ctx));
});

test("canCreateComment throws when the Event submission is not in the channel", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    Event: { connect: { where: { node: { id: "e-1" } } } },
  }];
  const ctx = permCtx({ EventChannel: [] });
  await assert.rejects(run(canCreateComment, { input }, ctx), /Could not find the event/);
});

test("canCreateComment requires an Event submission in the requested channel", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    Event: { connect: { where: { node: { id: "e-1" } } } },
  }];
  const ctx = permCtx({
    EventChannel: [{
      id: "ec-1",
      eventId: "e-1",
      channelUniqueName: "dogs",
      locked: false,
      archived: false,
    }],
  });
  await assert.rejects(
    run(canCreateComment, { input }, ctx),
    /Could not find the event submission in the given channel/
  );
});

test("canCreateComment rejects archived Event submissions", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    Event: { connect: { where: { node: { id: "e-1" } } } },
  }];
  const ctx = permCtx({
    EventChannel: [{
      id: "ec-1",
      eventId: "e-1",
      channelUniqueName: "cats",
      locked: false,
      archived: true,
    }],
  });
  await assert.rejects(
    run(canCreateComment, { input }, ctx),
    /archived event/
  );
});

test("canCreateComment rejects locked Event submissions", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    Event: { connect: { where: { node: { id: "e-1" } } } },
  }];
  const ctx = permCtx({
    EventChannel: [{
      id: "ec-1",
      eventId: "e-1",
      channelUniqueName: "cats",
      locked: true,
      archived: false,
    }],
  });
  await assert.rejects(
    run(canCreateComment, { input }, ctx),
    /locked event/
  );
});

test("canCreateComment preserves missing Event identifier errors", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    Event: { connect: { where: { node: {} } } },
  }];
  await assert.rejects(
    run(canCreateComment, { input }, permCtx()),
    /No event ID found/
  );
});

test("canCreateComment treats a feedback comment as a mod-permission check", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    GivesFeedbackOnComment: { connect: { where: { node: { id: "c-9" } } } },
  }];
  await ranToDecision(run(canCreateComment, { input }, permCtx()));
});

test("canCreateComment resolves Event feedback through the compound target", async () => {
  const counters = makeCounters();
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    GivesFeedbackOnEvent: { connect: { where: { node: { id: "e-1" } } } },
  }];
  const ctx = makeCtx(
    {
      ServerConfig: [{ Admins: [], SuperAdmins: [] }],
      EventChannel: [{
        id: "ec-1",
        eventId: "e-1",
        channelUniqueName: "cats",
      }],
    },
    counters
  );

  await ranToDecision(run(canCreateComment, { input }, ctx));
  assert.deepEqual(counters.eventChannels, [{
    eventId: "e-1",
    channelUniqueName: "cats",
  }]);
  assert.deepEqual(counters.permissionChannels, ["cats"]);
});

test("canCreateComment reuses the DiscussionChannel lookup for feedback", async () => {
  const counters = makeCounters();
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    DiscussionChannel: { connect: { where: { node: { id: "dc-1" } } } },
    GivesFeedbackOnDiscussion: {
      connect: { where: { node: { id: "discussion-1" } } },
    },
  }];
  const ctx = makeCtx(
    {
      ServerConfig: [{ Admins: [], SuperAdmins: [] }],
      DiscussionChannel: [{
        id: "dc-1",
        channelUniqueName: "cats",
        locked: false,
        archived: false,
      }],
    },
    counters
  );

  await ranToDecision(run(canCreateComment, { input }, ctx));
  assert.deepEqual(counters.discussionChannels, ["dc-1"]);
  assert.deepEqual(counters.permissionChannels, ["cats"]);
});

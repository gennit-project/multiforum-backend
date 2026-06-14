import assert from "node:assert/strict";
import test from "node:test";
import type { CommentCreateInput } from "../../src/generated/graphql.js";
import { validateFeedbackEnabled } from "./commentIsValid.js";
import { validateEventChannelsEnabled } from "./eventIsValid.js";
import { ModelStub } from "../../tests/testUtils.js";

const createContext = ({
  channel,
}: {
  channel: Record<string, unknown> | null;
}) => ({
  ogm: {
    model: (name: string) => {
      assert.equal(name, "Channel");
      return new ModelStub(() => (channel ? [channel] : []));
    },
  },
});

const feedbackCommentInput = (): CommentCreateInput => ({
  isRootComment: false,
  isFeedbackComment: true,
  text: "Please improve this.",
  Channel: {
    connect: {
      where: {
        node: {
          uniqueName: "cats",
        },
      },
    },
  },
  CommentAuthor: {
    ModerationProfile: {
      connect: {
        where: {
          node: {
            displayName: "mod-cat",
          },
        },
      },
    },
  },
  GivesFeedbackOnDiscussion: {
    connect: {
      where: {
        node: {
          id: "discussion-1",
        },
      },
    },
  },
});

test("event channel validation rejects disabled event channels", async () => {
  const result = await validateEventChannelsEnabled(
    ["cats"],
    createContext({
      channel: { uniqueName: "cats", eventsEnabled: false },
    })
  );

  assert.equal(result, "Events are disabled in channel 'cats'.");
});

test("event channel validation allows enabled event channels", async () => {
  const result = await validateEventChannelsEnabled(
    ["cats"],
    createContext({
      channel: { uniqueName: "cats", eventsEnabled: true },
    })
  );

  assert.equal(result, true);
});

test("feedback validation rejects disabled feedback channels", async () => {
  const result = await validateFeedbackEnabled(
    feedbackCommentInput(),
    createContext({
      channel: { uniqueName: "cats", feedbackEnabled: false },
    })
  );

  assert.equal(result, "Feedback is disabled in channel 'cats'.");
});

test("feedback validation ignores regular comments", async () => {
  const input = feedbackCommentInput();
  delete input.GivesFeedbackOnDiscussion;

  const result = await validateFeedbackEnabled(
    input,
    createContext({
      channel: { uniqueName: "cats", feedbackEnabled: false },
    })
  );

  assert.equal(result, true);
});

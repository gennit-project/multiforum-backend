import assert from "node:assert/strict";
import test from "node:test";
import type { CommentCreateInput } from "../../src/generated/graphql.js";
import { validateFeedbackEnabled } from "./commentIsValid.js";
import {
  validateDiscussionDownloadPreferences,
  validateDiscussionImagePreferences,
} from "./discussionIsValid.js";
import { validateEventChannelsEnabled } from "./eventIsValid.js";
import { ModelStub } from "../../tests/testUtils.js";
import type { GraphQLContext } from "../../types/context.js";

const createContext = ({
  channel,
  discussion,
  downloadableFile,
  serverConfig = { allowedFileTypes: [] },
}: {
  channel: Record<string, unknown> | null;
  discussion?: Record<string, unknown> | null;
  downloadableFile?: Record<string, unknown> | null;
  serverConfig?: Record<string, unknown>;
}) => ({
  ogm: {
    model: (name: string) => {
      if (name === "Channel") {
        return new ModelStub(() => (channel ? [channel] : []));
      }

      if (name === "ServerConfig") {
        return new ModelStub(() => [serverConfig]);
      }

      if (name === "DownloadableFile") {
        return new ModelStub(() => (downloadableFile ? [downloadableFile] : []));
      }

      if (name === "Discussion") {
        return new ModelStub(() => (discussion ? [discussion] : []));
      }

      throw new Error(`Unexpected model lookup: ${name}`);
    },
  },
} as unknown as GraphQLContext);

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

test("download validation rejects disabled download channels", async () => {
  const result = await validateDiscussionDownloadPreferences(
    {
      discussionInput: {
        title: "Download",
        hasDownload: true,
      },
      channelConnections: ["cats"],
    },
    createContext({
      channel: { uniqueName: "cats", downloadsEnabled: false },
    })
  );

  assert.equal(result, "Downloads are disabled in channel 'cats'.");
});

test("download validation rejects disallowed channel file types", async () => {
  const result = await validateDiscussionDownloadPreferences(
    {
      discussionInput: {
        title: "Download",
        hasDownload: true,
        DownloadableFiles: {
          connect: [{ where: { node: { id: "file-1" } } }],
        },
      },
      channelConnections: ["cats"],
    },
    createContext({
      channel: {
        uniqueName: "cats",
        downloadsEnabled: true,
        allowedFileTypes: ["stl"],
      },
      downloadableFile: { id: "file-1", fileName: "archive.zip" },
    })
  );

  assert.equal(
    result,
    "File type 'zip' is not allowed in channel 'cats'. Allowed types: stl"
  );
});

test("download validation allows enabled channels with allowed file types", async () => {
  const result = await validateDiscussionDownloadPreferences(
    {
      discussionInput: {
        title: "Download",
        hasDownload: true,
        DownloadableFiles: {
          connect: [{ where: { node: { id: "file-1" } } }],
        },
      },
      channelConnections: ["cats"],
    },
    createContext({
      channel: {
        uniqueName: "cats",
        downloadsEnabled: true,
        allowedFileTypes: ["zip"],
      },
      downloadableFile: { id: "file-1", fileName: "archive.zip" },
    })
  );

  assert.equal(result, true);
});

test("download validation on update resolves the discussion's channels from where", async () => {
  // The update path passes `where` instead of channelConnections; the
  // discussion's existing channels are resolved and their download rules apply.
  const result = await validateDiscussionDownloadPreferences(
    {
      discussionInput: { hasDownload: true },
      where: { id: "discussion-1" },
    },
    createContext({
      channel: { uniqueName: "cats", downloadsEnabled: false },
      discussion: { DiscussionChannels: [{ channelUniqueName: "cats" }] },
    })
  );

  assert.equal(result, "Downloads are disabled in channel 'cats'.");
});

test("discussion image validation rejects disabled image upload channels on create", async () => {
  const result = await validateDiscussionImagePreferences(
    {
      discussionInput: {
        Album: {
          create: {
            node: {
              Images: {
                connect: [{ where: { node: { id: "image-1" } } }],
              },
            },
          },
        },
      },
      channelConnections: ["cats"],
    },
    createContext({
      channel: { uniqueName: "cats", imageUploadsEnabled: false },
    })
  );

  assert.equal(result, "Image uploads are disabled in channel 'cats'.");
});

test("discussion image validation rejects disabled image upload channels on update", async () => {
  const result = await validateDiscussionImagePreferences(
    {
      discussionInput: {
        Album: {
          update: {
            node: {
              Images: [
                {
                  connect: [{ where: { node: { id: "image-1" } } }],
                },
              ],
            },
          },
        },
      },
      where: { id: "discussion-1" },
    },
    createContext({
      channel: { uniqueName: "cats", imageUploadsEnabled: false },
      discussion: {
        id: "discussion-1",
        DiscussionChannels: [{ channelUniqueName: "cats" }],
      },
    })
  );

  assert.equal(result, "Image uploads are disabled in channel 'cats'.");
});

test("discussion image validation ignores album image removals", async () => {
  const result = await validateDiscussionImagePreferences(
    {
      discussionInput: {
        Album: {
          update: {
            node: {
              Images: [
                {
                  disconnect: [{ where: { node: { id: "image-1" } } }],
                },
              ],
            },
          },
        },
      },
      channelConnections: ["cats"],
    },
    createContext({
      channel: { uniqueName: "cats", imageUploadsEnabled: false },
    })
  );

  assert.equal(result, true);
});

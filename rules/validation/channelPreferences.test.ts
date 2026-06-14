import assert from "node:assert/strict";
import test from "node:test";
import type { CommentCreateInput } from "../../src/generated/graphql.js";
import { validateFeedbackEnabled } from "./commentIsValid.js";
import { validateDiscussionDownloadPreferences } from "./discussionIsValid.js";
import { validateEventChannelsEnabled } from "./eventIsValid.js";
import { ModelStub } from "../../tests/testUtils.js";

const createContext = ({
  channel,
  downloadableFile,
  serverConfig = { allowedFileTypes: [] },
}: {
  channel: Record<string, unknown> | null;
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

      throw new Error(`Unexpected model lookup: ${name}`);
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

test("download validation rejects disabled download channels", async () => {
  const result = await validateDiscussionDownloadPreferences(
    {
      discussionCreateInput: {
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
      discussionCreateInput: {
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
      discussionCreateInput: {
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

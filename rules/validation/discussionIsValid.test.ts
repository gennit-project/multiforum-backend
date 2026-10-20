// Unit tests for the discussion validation helpers: album-image detection and
// the image/download channel-preference checks. Driven with an in-memory OGM;
// no DB. (The graphql-shield rule wrappers are exercised by integration.)
import assert from "node:assert/strict";
import test from "node:test";
import {
  albumInputCreatesOrConnectsImages,
  validateDiscussionImagePreferences,
  validateDiscussionDownloadPreferences,
} from "./discussionIsValid.js";

// Configurable policy, file and content validation repositories.
function makeCtx(opts: { channel?: any; downloadableFile?: any } = {}) {
  const ctx: any = {
    driver: {},
    downloadableFileRepository: {
      findUrlAccess: async () => null,
      findAttachmentMetadata: async () => opts.downloadableFile ?? null,
    },
    contentFeaturePolicyRepository: {
      findChannelPolicy: async (uniqueName: string) => {
        const channel = opts.channel === null
          ? null
          : opts.channel ?? {
              uniqueName: "cats",
              imageUploadsEnabled: true,
              downloadsEnabled: true,
              allowedFileTypes: [],
            };
        return {
          found: !!channel,
          uniqueName: channel ? uniqueName : null,
          eventsEnabled: null,
          feedbackEnabled: null,
          downloadsEnabled:
            typeof channel?.downloadsEnabled === "boolean"
              ? channel.downloadsEnabled
              : null,
          imageUploadsEnabled:
            typeof channel?.imageUploadsEnabled === "boolean"
              ? channel.imageUploadsEnabled
              : null,
          wikiEnabled: null,
          allowedFileTypes: channel?.allowedFileTypes ?? [],
        };
      },
      findServerFileTypePolicy: async () => ({
        found: true,
        allowedFileTypes: [],
      }),
    },
    contentValidationRepository: {findDiscussionChannels: async () => []},
  };
  return ctx;
}

const albumWithImage = { create: [{ node: { Images: { create: [{ node: {} }] } } }] };

test("albumInputCreatesOrConnectsImages detects created/connected images", () => {
  assert.equal(albumInputCreatesOrConnectsImages(albumWithImage), true);
  assert.equal(albumInputCreatesOrConnectsImages({ create: [{ node: { Images: { connect: [{ where: {} }] } } }] }), true);
  assert.equal(albumInputCreatesOrConnectsImages(undefined), false);
  assert.equal(albumInputCreatesOrConnectsImages({ create: [{ node: {} }] }), false);
});

const attachments = (...ids: string[]) => ({
  DownloadableFiles: { connect: ids.map((id) => ({ where: { node: { id } } })) },
});

test("attachment validation retains per-file ordering, including duplicate IDs", async () => {
  const calls: string[] = [];
  const ctx = makeCtx();
  const policy = ctx.contentFeaturePolicyRepository;
  const findChannel = policy.findChannelPolicy;
  policy.findChannelPolicy = async (name: string) => {
    calls.push(`channel:${name}`);
    return findChannel(name);
  };
  policy.findServerFileTypePolicy = async () => {
    calls.push("server");
    return { found: true, allowedFileTypes: ["zip"] };
  };
  ctx.downloadableFileRepository.findAttachmentMetadata = async (id: string) => {
    calls.push(`file:${id}`);
    return { id, fileName: "archive.zip" };
  };
  assert.equal(await validateDiscussionDownloadPreferences({
    discussionInput: attachments("a", "a", "b"), channelConnections: ["cats"],
  }, ctx), true);
  assert.deepEqual(calls, [
    "channel:cats",
    "file:a", "server", "channel:cats",
    "file:a", "server", "channel:cats",
    "file:b", "server", "channel:cats",
  ]);
});

test("disabled channels stop before file lookup and missing files stop at the first failure", async () => {
  const ctx = makeCtx({ channel: { downloadsEnabled: false } });
  const ids: string[] = [];
  ctx.downloadableFileRepository.findAttachmentMetadata = async (id: string) => {
    ids.push(id);
    return null;
  };
  const input = { discussionInput: attachments("missing", "later"), channelConnections: ["cats"] };
  assert.equal(await validateDiscussionDownloadPreferences(input, ctx), "Downloads are disabled in channel 'cats'.");
  assert.deepEqual(ids, []);
  ctx.contentFeaturePolicyRepository.findChannelPolicy = async () => ({ found: true });
  assert.equal(await validateDiscussionDownloadPreferences(input, ctx), "Downloadable file 'missing' not found");
  assert.deepEqual(ids, ["missing"]);
});

test("server type rejection precedes channel type validation and later attachments", async () => {
  const calls: string[] = [];
  const ctx = makeCtx();
  ctx.contentFeaturePolicyRepository.findChannelPolicy = async () => {
    calls.push("channel");
    return { found: true, allowedFileTypes: ["png"] };
  };
  ctx.contentFeaturePolicyRepository.findServerFileTypePolicy = async () => {
    calls.push("server");
    return { found: true, allowedFileTypes: ["png"] };
  };
  ctx.downloadableFileRepository.findAttachmentMetadata = async (id: string) => {
    calls.push(id);
    return { id, fileName: "archive.zip" };
  };
  assert.equal(await validateDiscussionDownloadPreferences({
    discussionInput: attachments("first", "later"), channelConnections: ["cats"],
  }, ctx), "File type 'zip' is not allowed by server configuration. Allowed types: png");
  assert.deepEqual(calls, ["channel", "first", "server"]);
});

test("array connections retain order and empty filenames retain the existing validation fast path", async () => {
  const ctx = makeCtx();
  const ids: string[] = [];
  ctx.downloadableFileRepository.findAttachmentMetadata = async (id: string) => {
    ids.push(id);
    return { id, fileName: "" };
  };
  ctx.contentFeaturePolicyRepository.findServerFileTypePolicy = async () => {
    throw new Error("empty filenames skip file-type checks");
  };
  const discussionInput = {
    DownloadableFiles: [
      attachments("a").DownloadableFiles,
      { connect: [{ where: {} }, { where: { node: { id: 7 } } }] },
      attachments("b").DownloadableFiles,
    ],
  };
  assert.equal(await validateDiscussionDownloadPreferences({
    discussionInput, channelConnections: ["cats"],
  }, ctx), true);
  assert.deepEqual(ids, ["a", "b"]);
});

test("attachment lookup errors propagate without validating subsequent files", async () => {
  const ctx = makeCtx();
  const ids: string[] = [];
  ctx.downloadableFileRepository.findAttachmentMetadata = async (id: string) => {
    ids.push(id);
    throw new Error("read failed");
  };
  await assert.rejects(validateDiscussionDownloadPreferences({
    discussionInput: attachments("first", "later"), channelConnections: ["cats"],
  }, ctx), /read failed/);
  assert.deepEqual(ids, ["first"]);
});

test("validateDiscussionImagePreferences passes when no album images are involved", async () => {
  const ctx = makeCtx();
  assert.equal(await validateDiscussionImagePreferences({ discussionInput: {} }, ctx), true);
});

test("validateDiscussionImagePreferences errors when no channel is specified", async () => {
  const ctx = makeCtx();
  const result = await validateDiscussionImagePreferences({ discussionInput: { Album: albumWithImage } }, ctx);
  assert.match(String(result), /No channel specified/);
});

test("validateDiscussionImagePreferences passes when the channel allows image uploads", async () => {
  const ctx = makeCtx({ channel: { uniqueName: "cats", imageUploadsEnabled: true } });
  const result = await validateDiscussionImagePreferences(
    { discussionInput: { Album: albumWithImage }, channelConnections: ["cats"] },
    ctx
  );
  assert.equal(result, true);
});

test("validateDiscussionImagePreferences errors when the channel disables image uploads", async () => {
  const ctx = makeCtx({ channel: { uniqueName: "cats", imageUploadsEnabled: false } });
  const result = await validateDiscussionImagePreferences(
    { discussionInput: { Album: albumWithImage }, channelConnections: ["cats"] },
    ctx
  );
  assert.match(String(result), /disabled/);
});

test("validateDiscussionImagePreferences errors when the channel is not found", async () => {
  const ctx = makeCtx({ channel: null });
  const result = await validateDiscussionImagePreferences(
    { discussionInput: { Album: albumWithImage }, channelConnections: ["ghost"] },
    ctx
  );
  assert.match(String(result), /not found/);
});

test("validateDiscussionDownloadPreferences passes when there is no download", async () => {
  const ctx = makeCtx();
  assert.equal(await validateDiscussionDownloadPreferences({ discussionInput: {} }, ctx), true);
});

test("validateDiscussionDownloadPreferences errors when a download has no channel", async () => {
  const ctx = makeCtx();
  const result = await validateDiscussionDownloadPreferences({ discussionInput: { hasDownload: true } }, ctx);
  assert.match(String(result), /No channel specified/);
});

test("validateDiscussionDownloadPreferences passes for a download in a downloads-enabled channel", async () => {
  const ctx = makeCtx({ channel: { uniqueName: "cats", downloadsEnabled: true, allowedFileTypes: [] } });
  const result = await validateDiscussionDownloadPreferences(
    { discussionInput: { hasDownload: true }, channelConnections: ["cats"] },
    ctx
  );
  assert.equal(result, true);
});

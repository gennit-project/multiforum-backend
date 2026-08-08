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

// ctx.ogm with a configurable Channel row and DownloadableFile lookup.
function makeCtx(opts: { channel?: any; downloadableFile?: any } = {}) {
  const ctx: any = {
    ogm: {
      model(name: string) {
        return {
          find: async () => {
            if (name === "Channel") {
              return opts.channel === null ? [] : [opts.channel ?? {
                uniqueName: "cats",
                imageUploadsEnabled: true,
                downloadsEnabled: true,
                allowedFileTypes: [],
              }];
            }
            if (name === "DownloadableFile") {
              return opts.downloadableFile ? [opts.downloadableFile] : [];
            }
            return [];
          },
        };
      },
    },
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

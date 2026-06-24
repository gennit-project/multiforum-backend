import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDownloadChannelsEnabled,
  validateFileTypePermissions,
} from "./downloadableFileIsValid.js";
import { makeOgm } from "../../tests/fixtures/index.js";

type ValidationCtx = Parameters<typeof validateDownloadChannelsEnabled>[1];

type ChannelStub = {
  downloadsEnabled?: boolean;
  allowedFileTypes?: string[];
};

const ctxWith = (opts: {
  channels?: Record<string, ChannelStub>;
  serverAllowedFileTypes?: string[];
}) => ({
  ogm: makeOgm({
    Channel: {
      find: async ({ where }: { where: { uniqueName: string } }) => {
        const channel = opts.channels?.[where.uniqueName];
        return channel ? [{ uniqueName: where.uniqueName, ...channel }] : [];
      },
    },
    ServerConfig: {
      find: async () => [
        { allowedFileTypes: opts.serverAllowedFileTypes ?? [] },
      ],
    },
  }).ogm,
  req: {},
} as unknown as ValidationCtx);

// --- validateDownloadChannelsEnabled ---

test("passes when there are no channel connections", async () => {
  assert.equal(await validateDownloadChannelsEnabled([], ctxWith({})), true);
  assert.equal(
    await validateDownloadChannelsEnabled(undefined, ctxWith({})),
    true
  );
});

test("passes when downloads are enabled in every channel", async () => {
  const ctx = ctxWith({ channels: { cats: { downloadsEnabled: true } } });
  assert.equal(await validateDownloadChannelsEnabled(["cats"], ctx), true);
});

test("fails when a channel is not found", async () => {
  const ctx = ctxWith({ channels: {} });
  assert.equal(
    await validateDownloadChannelsEnabled(["ghost"], ctx),
    "Channel 'ghost' not found"
  );
});

test("fails when downloads are disabled in a channel", async () => {
  const ctx = ctxWith({ channels: { cats: { downloadsEnabled: false } } });
  assert.equal(
    await validateDownloadChannelsEnabled(["cats"], ctx),
    "Downloads are disabled in channel 'cats'."
  );
});

// --- validateFileTypePermissions ---

test("skips validation when no filename is given", async () => {
  assert.equal(await validateFileTypePermissions("", undefined, ctxWith({})), true);
});

test("rejects a filename with no usable extension", async () => {
  assert.equal(
    await validateFileTypePermissions("file.", undefined, ctxWith({})),
    "File must have a valid extension"
  );
});

test("allows any type when the server allow-list is empty", async () => {
  const ctx = ctxWith({ serverAllowedFileTypes: [] });
  assert.equal(await validateFileTypePermissions("model.stl", undefined, ctx), true);
});

test("rejects a type not in the server allow-list", async () => {
  const ctx = ctxWith({ serverAllowedFileTypes: ["png", "jpg"] });
  const result = await validateFileTypePermissions("model.stl", undefined, ctx);
  assert.match(result as string, /File type 'stl' is not allowed by server configuration/);
});

test("matches server allow-list entries written with a leading dot", async () => {
  const ctx = ctxWith({ serverAllowedFileTypes: [".stl"] });
  assert.equal(await validateFileTypePermissions("model.STL", undefined, ctx), true);
});

test("rejects a type not allowed in a specific channel", async () => {
  const ctx = ctxWith({
    serverAllowedFileTypes: ["stl"],
    channels: { cats: { downloadsEnabled: true, allowedFileTypes: ["png"] } },
  });
  const result = await validateFileTypePermissions("model.stl", ["cats"], ctx);
  assert.match(result as string, /File type 'stl' is not allowed in channel 'cats'/);
});

test("passes when the type is allowed by both server and channel", async () => {
  const ctx = ctxWith({
    serverAllowedFileTypes: ["stl"],
    channels: { cats: { downloadsEnabled: true, allowedFileTypes: ["stl"] } },
  });
  assert.equal(
    await validateFileTypePermissions("model.stl", ["cats"], ctx),
    true
  );
});

test("fails when the target channel has downloads disabled", async () => {
  const ctx = ctxWith({
    serverAllowedFileTypes: ["stl"],
    channels: { cats: { downloadsEnabled: false, allowedFileTypes: ["stl"] } },
  });
  assert.equal(
    await validateFileTypePermissions("model.stl", ["cats"], ctx),
    "Downloads are disabled in channel 'cats'."
  );
});

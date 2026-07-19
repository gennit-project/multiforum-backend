import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { createPrepareDownloadResolver } from "./prepareDownload.js";

const buildInput = (initialFile: Record<string, unknown>) => {
  let file = initialFile;
  return {
    input: {
      DownloadableFile: { find: async () => [file] },
      Plugin: {},
      PluginVersion: {},
      PluginRun: {},
      ServerConfig: {},
      ServerSecret: {},
      driver: {},
    } as any,
    updateFile: (updates: Record<string, unknown>) => {
      file = { ...file, ...updates };
    },
  };
};

const baseFile = {
  id: "file-1",
  url: "https://storage.example.com/file.zip",
  storageBucket: "downloads",
  storageObjectName: "uploads/alice/file.zip",
  scanStatus: "CLEAN",
  uploadedByUsername: "alice",
  Discussion: {
    id: "discussion-1",
    Author: { username: "alice" },
  },
};

const contextFor = (username: string) => ({
  user: {
    username,
    email: `${username}@example.com`,
    email_verified: true,
    data: null,
  },
}) as GraphQLContext;

test("runs the download scanner before returning a signed read URL", async () => {
  const { input, updateFile } = buildInput(baseFile);
  const calls = { tracked: 0, signedOptions: null as unknown };
  const resolver = createPrepareDownloadResolver(
    input,
    (async () => {
      updateFile({
        scanStatus: "CLEAN",
        scanCheckedAt: "2026-07-19T12:00:00Z",
      });
      return [{ pluginId: "security-attachment-scan", status: "SUCCEEDED" }];
    }) as any,
    async () => false,
    () => ({
      bucket: () => ({
        file: () => ({
          getSignedUrl: async (options: unknown) => {
            calls.signedOptions = options;
            return ["https://signed.example.com/file.zip"];
          },
        }),
      }),
    }) as any,
    (async () => {
      calls.tracked += 1;
      return true;
    }) as any
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    contextFor("bob")
  );

  assert.deepEqual({
    ready: result.ready,
    url: result.url,
    status: result.scanStatus,
    message: result.message,
    tracked: calls.tracked,
    signedAction: (calls.signedOptions as { action?: string })?.action,
  }, {
    ready: true,
    url: "https://signed.example.com/file.zip",
    status: "CLEAN",
    message: "No threats found. Your download is ready.",
    tracked: 1,
    signedAction: "read",
  });
});

test("reuses a recent clean scan without invoking the scanner", async () => {
  const { input } = buildInput({
    ...baseFile,
    scanCheckedAt: "2026-07-19T11:55:00Z",
  });
  const calls = { scanned: 0, tracked: 0 };
  const resolver = createPrepareDownloadResolver(
    input,
    (async () => {
      calls.scanned += 1;
      return [];
    }) as any,
    async () => false,
    () => ({
      bucket: () => ({
        file: () => ({
          getSignedUrl: async () => ["https://signed.example.com/file.zip"],
        }),
      }),
    }) as any,
    (async () => {
      calls.tracked += 1;
      return true;
    }) as any,
    {
      now: () => new Date("2026-07-19T12:00:00Z"),
      scanCacheTtlMs: 15 * 60 * 1000,
    }
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    contextFor("bob")
  );

  assert.deepEqual({
    ready: result.ready,
    scanned: calls.scanned,
    tracked: calls.tracked,
  }, {
    ready: true,
    scanned: 0,
    tracked: 1,
  });
});

test("rescans an expired clean result", async () => {
  const { input, updateFile } = buildInput({
    ...baseFile,
    storageBucket: null,
    storageObjectName: null,
    scanCheckedAt: "2026-07-19T11:44:59Z",
  });
  let scanned = 0;
  const resolver = createPrepareDownloadResolver(
    input,
    (async () => {
      scanned += 1;
      updateFile({ scanCheckedAt: "2026-07-19T12:00:00Z" });
      return [{ pluginId: "security-attachment-scan", status: "SUCCEEDED" }];
    }) as any,
    async () => false,
    (() => ({})) as any,
    (async () => true) as any,
    {
      now: () => new Date("2026-07-19T12:00:00Z"),
      scanCacheTtlMs: 15 * 60 * 1000,
    }
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    contextFor("bob")
  );

  assert.equal(result.ready, true);
  assert.equal(scanned, 1);
});

test("shares one scan between concurrent download preparations", async () => {
  const { input, updateFile } = buildInput(baseFile);
  let releaseScan: (() => void) | undefined;
  const scanGate = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  const calls = { scanned: 0, tracked: 0 };
  const resolver = createPrepareDownloadResolver(
    input,
    (async () => {
      calls.scanned += 1;
      await scanGate;
      updateFile({
        scanStatus: "CLEAN",
        scanCheckedAt: "2026-07-19T12:00:00Z",
      });
      return [{ pluginId: "security-attachment-scan", status: "SUCCEEDED" }];
    }) as any,
    async () => false,
    () => ({
      bucket: () => ({
        file: () => ({
          getSignedUrl: async () => ["https://signed.example.com/file.zip"],
        }),
      }),
    }) as any,
    (async () => {
      calls.tracked += 1;
      return true;
    }) as any
  );

  const first = resolver(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    contextFor("bob")
  );
  const second = resolver(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    contextFor("carol")
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.scanned, 1);
  releaseScan?.();
  const results = await Promise.all([first, second]);

  assert.deepEqual(results.map((result) => result.ready), [true, true]);
  assert.equal(calls.scanned, 1);
  assert.equal(calls.tracked, 2);
});

test("clears a failed in-flight scan so a later request can retry", async () => {
  const { input, updateFile } = buildInput({
    ...baseFile,
    storageBucket: null,
    storageObjectName: null,
  });
  let scanned = 0;
  const resolver = createPrepareDownloadResolver(
    input,
    (async () => {
      scanned += 1;
      if (scanned === 1) throw new Error("scanner unavailable");
      updateFile({ scanCheckedAt: "2026-07-19T12:00:00Z" });
      return [{ pluginId: "security-attachment-scan", status: "SUCCEEDED" }];
    }) as any,
    async () => false,
    (() => ({})) as any,
    (async () => true) as any
  );

  await assert.rejects(
    resolver(
      null,
      { downloadableFileId: "file-1", discussionId: "discussion-1" },
      contextFor("bob")
    ),
    /scanner unavailable/
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    contextFor("bob")
  );

  assert.equal(result.ready, true);
  assert.equal(scanned, 2);
});

test("withholds a blocked download and its private scanner reason", async () => {
  const { input, updateFile } = buildInput(baseFile);
  let tracked = false;
  const resolver = createPrepareDownloadResolver(
    input,
    (async () => {
      updateFile({ scanStatus: "INFECTED", scanReason: "Private signature" });
      return [{ pluginId: "security-attachment-scan", status: "FAILED" }];
    }) as any,
    async () => false,
    (() => ({})) as any,
    (async () => {
      tracked = true;
      return true;
    }) as any
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    contextFor("bob")
  );

  assert.deepEqual({
    ready: result.ready,
    url: result.url,
    status: result.scanStatus,
    reason: result.scanReason,
    tracked,
  }, {
    ready: false,
    url: null,
    status: "INFECTED",
    reason: null,
    tracked: false,
  });
});

test("lets the creator prepare a held file for human review", async () => {
  const { input, updateFile } = buildInput({
    ...baseFile,
    storageBucket: null,
    storageObjectName: null,
  });
  const resolver = createPrepareDownloadResolver(
    input,
    (async () => {
      updateFile({ scanStatus: "SUSPICIOUS", scanReason: "Archive heuristic" });
      return [{ pluginId: "security-attachment-scan", status: "FAILED" }];
    }) as any,
    async () => false,
    (() => ({})) as any,
    (async () => true) as any
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    contextFor("alice")
  );

  assert.deepEqual({
    ready: result.ready,
    url: result.url,
    status: result.scanStatus,
    reason: result.scanReason,
    reviewAccess: result.reviewAccess,
  }, {
    ready: true,
    url: "https://storage.example.com/file.zip",
    status: "SUSPICIOUS",
    reason: "Archive heuristic",
    reviewAccess: true,
  });
});

test("fails closed when no pre-download security scanner is configured", async () => {
  const { input } = buildInput(baseFile);
  const resolver = createPrepareDownloadResolver(
    input,
    (async () => []) as any,
    async () => false
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    contextFor("bob")
  );

  assert.deepEqual({
    ready: result.ready,
    status: result.scanStatus,
    message: result.message,
  }, {
    ready: false,
    status: "FAILED",
    message: "The download security scanner is not configured.",
  });
});

test("rejects a file that does not belong to the requested discussion", async () => {
  const { input } = buildInput(baseFile);
  const resolver = createPrepareDownloadResolver(input);

  await assert.rejects(
    resolver(
      null,
      { downloadableFileId: "file-1", discussionId: "discussion-2" },
      contextFor("bob")
    ),
    /Downloadable file not found for this discussion/
  );
});

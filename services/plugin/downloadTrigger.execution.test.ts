// Execution-path tests for the downloadable-file trigger's per-plugin run
// lifecycle. The real plugin loader is replaced via the injectable `loadPlugin`
// dependency with a fake in-memory plugin; models are stubbed and PluginRun
// create/update calls captured to assert status transitions. No DB or network.
import assert from "node:assert/strict";
import test from "node:test";
import { triggerPluginRunsForDownloadableFile } from "./downloadTrigger.js";

const EVENT = "downloadableFile.created";

const model = (rows: unknown[]) => ({ find: async () => rows });
const empty = () => model([]);

const installedEdge = (name: string) => ({
  properties: { enabled: true, settingsJson: null },
  node: {
    id: `pv-${name}`,
    version: "1.0.0",
    repoUrl: null,
    tarballGsUri: `gs://bucket/${name}.tgz`,
    entryPath: "dist/index.js",
    manifest: JSON.stringify({ events: [EVENT, "downloadableFile.updated"] }),
    settingsDefaults: null,
    uiSchema: null,
    Plugin: { id: `p-${name}`, name, displayName: name, description: "", metadata: null },
  },
});

const fileNode = {
  id: "f-1",
  fileName: "a.zip",
  url: "http://x/a.zip",
  kind: "zip",
  size: 10,
  Discussion: {
    id: "d-1",
    title: "T",
    body: "B",
    DiscussionChannels: [
      { channelUniqueName: "cats", Channel: { uniqueName: "cats", displayName: "Cats", description: "", rules: [] } },
    ],
  },
};

function makeExecModels(edges: unknown[], file = fileNode) {
  const updates: any[] = [];
  const creates: any[] = [];
  const fileUpdates: any[] = [];
  let seq = 0;
  const serverConfig = {
    serverName: "s",
    pluginPipelines: null,
    InstalledVersionsConnection: { edges },
  };
  const PluginRun = {
    create: async (args: any) => {
      creates.push(args);
      seq += 1;
      return { pluginRuns: [{ id: `run-${seq}` }] };
    },
    update: async (args: any) => {
      updates.push(args);
      return {};
    },
    find: async (args: any) => [{ id: args?.where?.id ?? "run-1" }],
  };
  const models: any = {
    DownloadableFile: {
      ...model([file]),
      update: async (args: any) => {
        fileUpdates.push(args);
        return {};
      },
    },
    ServerConfig: model([serverConfig]),
    ServerSecret: empty(),
    PluginRun,
    Plugin: empty(),
    PluginVersion: empty(),
  };
  return { models, updates, creates, fileUpdates };
}

const pluginReturning = (result: unknown) =>
  class {
    constructor(public ctx: unknown) {}
    async handleEvent() {
      return result;
    }
  };
const loaderFor = (cls: unknown) => (async () => cls) as any;
const statusesOf = (updates: any[]) => updates.map((u) => u.update.status);

const execRun = (models: any, loadPlugin: any, storage?: any) =>
  triggerPluginRunsForDownloadableFile(
    { downloadableFileId: "f-1", event: EVENT, models },
    { loadPlugin, storage }
  );

test("runs a matching plugin to SUCCEEDED", async () => {
  const { models, updates, creates } = makeExecModels([installedEdge("mybot")]);
  const runs = await execRun(models, loaderFor(pluginReturning({ success: true, result: { message: "ok" } })));

  assert.equal(creates.length, 1);
  assert.equal(creates[0].input[0].status, "PENDING");
  const statuses = statusesOf(updates);
  assert.ok(statuses.includes("RUNNING"));
  assert.ok(statuses.includes("SUCCEEDED"));
  assert.equal(runs.length, 1);
});

test("gives plugins signed access to private objects without persisting the signature", async () => {
  const privateFile = {
    ...fileNode,
    url: "https://storage.googleapis.com/private-downloads/a.zip",
    storageBucket: "private-downloads",
    storageObjectName: "uploads/alice/a.zip",
  };
  const { models, updates } = makeExecModels(
    [installedEdge("security-attachment-scan")],
    privateFile
  );
  let receivedEvent: any;
  const Plugin = class {
    async handleEvent(event: unknown) {
      receivedEvent = event;
      return { success: true, result: { verdict: "clean" } };
    }
  };
  const storage = {
    bucket: (bucketName: string) => ({
      file: (objectName: string) => ({
        getSignedUrl: async () => [
          `https://signed.example.com/${bucketName}/${objectName}?signature=secret`,
        ],
      }),
    }),
  };

  await execRun(models, loaderFor(Plugin), storage);

  const completedPayload = JSON.parse(
    updates.find((update) => update.update.status === "SUCCEEDED").update.payload
  );
  assert.deepEqual({
    pluginAttachments: receivedEvent.payload.attachmentUrls,
    storedAttachments: completedPayload.attachments,
    storedPayloadContainsSignature: completedPayload.attachments.some(
      (url: string) => url.includes("signature=")
    ),
  }, {
    pluginAttachments: [
      "https://signed.example.com/private-downloads/uploads/alice/a.zip?signature=secret",
    ],
    storedAttachments: [privateFile.url],
    storedPayloadContainsSignature: false,
  });
});

test("marks the run FAILED when the plugin reports failure", async () => {
  const { models, updates } = makeExecModels([installedEdge("mybot")]);
  await execRun(models, loaderFor(pluginReturning({ success: false, error: "nope" })));
  assert.ok(statusesOf(updates).includes("FAILED"));
});

test("skips later plugins after a failure (stopOnFirstFailure)", async () => {
  const { models, updates } = makeExecModels([installedEdge("a"), installedEdge("b")]);
  let n = 0;
  const loader = (async () => {
    n += 1;
    if (n === 1) throw new Error("load boom");
    return pluginReturning({ success: true });
  }) as any;
  await execRun(models, loader);

  const statuses = statusesOf(updates);
  assert.ok(statuses.includes("FAILED"));
  assert.ok(statuses.includes("SKIPPED"));
});

test("persists the scanner verdict on the downloadable file", async () => {
  const { models, fileUpdates } = makeExecModels([
    installedEdge("security-attachment-scan"),
  ]);
  await execRun(
    models,
    loaderFor(
      pluginReturning({
        success: false,
        result: {
          verdict: "malicious",
          scans: [
            { verdict: "malicious", summary: "Known malware signature" },
          ],
        },
      })
    )
  );

  assert.deepEqual(fileUpdates[0], {
    where: { id: "f-1" },
    update: {
      scanStatus: "PENDING",
      scanReason: null,
      scanCheckedAt: null,
    },
  });
  assert.deepEqual(fileUpdates[1], {
    where: { id: "f-1" },
    update: {
      scanStatus: "INFECTED",
      scanReason: "Known malware signature",
      scanCheckedAt: fileUpdates[1].update.scanCheckedAt,
    },
  });
});

test("marks the downloadable file failed when the scanner throws", async () => {
  const { models, fileUpdates } = makeExecModels([
    installedEdge("security-attachment-scan"),
  ]);
  await execRun(
    models,
    (async () => {
      throw new Error("scan service unavailable");
    }) as any
  );

  assert.deepEqual(fileUpdates[1], {
    where: { id: "f-1" },
    update: {
      scanStatus: "FAILED",
      scanReason: "scan service unavailable",
      scanCheckedAt: fileUpdates[1].update.scanCheckedAt,
    },
  });
});

test("holds a replacement before the scanner begins", async () => {
  const { models, fileUpdates } = makeExecModels([
    installedEdge("security-attachment-scan"),
  ]);

  await triggerPluginRunsForDownloadableFile(
    {
      downloadableFileId: "f-1",
      event: "downloadableFile.updated",
      models,
    },
    {
      loadPlugin: loaderFor(
        pluginReturning({ success: true, result: { verdict: "clean" } })
      ),
    }
  );

  assert.equal(fileUpdates[0].update.scanStatus, "PENDING");
});

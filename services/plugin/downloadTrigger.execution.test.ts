// Execution-path tests for the downloadable-file trigger's per-plugin run
// lifecycle. The real plugin loader is replaced via the injectable `loadPlugin`
// dependency with a fake in-memory plugin; models are stubbed and PluginRun
// create/update calls captured to assert status transitions. No DB or network.
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap } from "../../ogm_types.js";
import { PluginPipelineRunTrigger } from "../../ogm_types.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import type { PublicDiagnosticInput } from "./publicDiagnostics.js";
import type {
  PluginConstructor,
  PluginRunResult,
} from "./pluginLoader.js";
import { triggerPluginRunsForDownloadableFile } from "./downloadTrigger.js";

type TriggerArgs = Parameters<typeof triggerPluginRunsForDownloadableFile>[0];
type TriggerOptions = NonNullable<
  Parameters<typeof triggerPluginRunsForDownloadableFile>[1]
>;
type Models = TriggerArgs["models"];
type LoadPlugin = NonNullable<TriggerOptions["loadPlugin"]>;
type StorageStub = NonNullable<TriggerOptions["storage"]>;
type RunCreateArgs = Parameters<ModelMap["PluginRun"]["create"]>[0];
type RunUpdateArgs = Parameters<ModelMap["PluginRun"]["update"]>[0];
type FileUpdateArgs =
  Parameters<ModelMap["DownloadableFile"]["update"]>[0];
type AttemptCreateArgs =
  Parameters<ModelMap["PluginPipelineRun"]["create"]>[0];
type AttemptUpdateArgs =
  Parameters<ModelMap["PluginPipelineRun"]["update"]>[0];

const EVENT = "downloadableFile.created";

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
  const updates: RunUpdateArgs[] = [];
  const creates: RunCreateArgs[] = [];
  const fileUpdates: FileUpdateArgs[] = [];
  const attemptCreates: AttemptCreateArgs[] = [];
  const attemptUpdates: AttemptUpdateArgs[] = [];
  let seq = 0;
  const serverConfig = {
    serverName: "s",
    pluginPipelines: null,
    InstalledVersionsConnection: { edges },
  };
  const PluginRun = modelStub<"PluginRun">({
    create: async args => {
      creates.push(args);
      seq += 1;
      return { pluginRuns: [{ id: `run-${seq}` }] };
    },
    update: async args => {
      updates.push(args);
      return { pluginRuns: [{ id: "run-1" }] };
    },
    find: async ({ where } = {}) => [{ id: where?.id ?? "run-1" }],
  });
  const PluginPipelineRun = modelStub<"PluginPipelineRun">({
    find: async () => [],
    create: async args => {
      attemptCreates.push(args);
      return {
        pluginPipelineRuns: [
          {
            id: 'attempt-1',
            pipelineId: args.input[0].pipelineId,
            attemptNumber: args.input[0].attemptNumber,
          },
        ],
      };
    },
    update: async args => {
      attemptUpdates.push(args);
      return {};
    },
  });
  const models = {
    DownloadableFile: modelStub<"DownloadableFile">({
      find: async () => [file],
      update: async args => {
        fileUpdates.push(args);
        return {};
      },
    }),
    ServerConfig: modelStub<"ServerConfig">({
      find: async () => [serverConfig],
    }),
    ServerSecret: modelStub<"ServerSecret">(),
    PluginPipelineRun,
    PluginRun,
    Plugin: modelStub<"Plugin">(),
    PluginVersion: modelStub<"PluginVersion">(),
  } satisfies Models;
  return {
    models,
    updates,
    creates,
    fileUpdates,
    attemptCreates,
    attemptUpdates,
  };
}

const pluginReturning = (result: PluginRunResult): PluginConstructor =>
  class {
    constructor(..._args: unknown[]) {}
    async handleEvent() {
      return result;
    }
  };
const loaderFor = (cls: PluginConstructor): LoadPlugin => async () => cls;
const statusesOf = (updates: RunUpdateArgs[]) =>
  updates.map(update => update.update?.status);

const execRun = (
  models: Models,
  loadPlugin: LoadPlugin,
  storage?: StorageStub
) =>
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

test("stores structured public diagnostics separately from internal logs", async () => {
  const { models, updates } = makeExecModels([installedEdge("mybot")]);
  type DiagnosticContext = {
    log: { internal: (message: string) => void };
    diagnostics: {
      public: (input: PublicDiagnosticInput) => unknown;
    };
  };
  const Plugin = class {
    private ctx: DiagnosticContext;

    constructor(...args: unknown[]) {
      this.ctx = args[0] as DiagnosticContext;
    }

    async handleEvent() {
      this.ctx.log.internal("internal provider request secret-value");
      this.ctx.diagnostics.public({
        level: "WARNING",
        code: "ARCHIVE_CONTAINS_EXECUTABLE",
        message: "The archive contains an executable file.",
        details: {
          path: "setup.exe",
          apiToken: "must-not-be-public",
        },
      });
      return { success: true };
    }
  };

  await execRun(models, loaderFor(Plugin));

  const completed = updates.find(
    update => update.update?.status === "SUCCEEDED"
  )?.update;
  assert.ok(completed);
  assert.deepEqual(
    {
      publicDiagnostics: JSON.parse(String(completed.publicDiagnostics)),
      internalPayload: JSON.parse(String(completed.payload)).logs,
    },
    {
      publicDiagnostics: [
        {
          level: "WARNING",
          code: "ARCHIVE_CONTAINS_EXECUTABLE",
          message: "The archive contains an executable file.",
          details: {
            path: "setup.exe",
            apiToken: "[REDACTED]",
          },
          helpUrl: null,
        },
      ],
      internalPayload: ["internal provider request secret-value"],
    }
  );
});

test("creates and completes a first-class pipeline attempt", async () => {
  const {
    models,
    attemptCreates,
    attemptUpdates,
  } = makeExecModels([installedEdge("mybot")]);

  await execRun(
    models,
    loaderFor(pluginReturning({ success: true, result: { message: "ok" } }))
  );
  const started = attemptUpdates.find(
    update => update.update?.status === "RUNNING"
  );
  const completed = attemptUpdates.find(
    update => update.update?.status === "SUCCEEDED"
  );

  assert.deepEqual(
    {
      created: attemptCreates[0]!.input[0],
      started: started!.update,
      completed: completed!.update,
      matchingPipelineId:
        attemptCreates[0]!.input[0]!.pipelineId ===
        completed!.where?.pipelineId,
    },
    {
      created: {
        pipelineId: attemptCreates[0]!.input[0]!.pipelineId,
        targetId: "f-1",
        targetType: "DownloadableFile",
        targetVersion: null,
        eventType: EVENT,
        scope: "SERVER",
        channelId: "cats",
        status: "QUEUED",
        trigger: "EVENT",
        initiatedByUsername: null,
        retryOfPipelineRunId: null,
        attemptNumber: 1,
        configurationSnapshot: {
          event: EVENT,
          stopOnFirstFailure: true,
          applicability: "ALL_FILES_IMMEDIATE",
          effectiveAt: null,
          steps: [
            {
              pluginId: "mybot",
              version: "1.0.0",
              order: 0,
              condition: "ALWAYS",
              continueOnError: false,
            },
          ],
        },
        applicability: "ALL_FILES_IMMEDIATE",
        policyEffectiveAt: null,
        policyId: null,
        campaignId: null,
        queuedAt: attemptCreates[0]!.input[0]!.queuedAt,
        timeoutAt: attemptCreates[0]!.input[0]!.timeoutAt,
        updatedAt: attemptCreates[0]!.input[0]!.updatedAt,
      },
      started: {
        status: "RUNNING",
        startedAt: attemptUpdates[0]!.update?.startedAt,
      },
      completed: {
        status: "SUCCEEDED",
        finishedAt: completed!.update?.finishedAt,
        timeoutAt: null,
      },
      matchingPipelineId: true,
    }
  );
});

test("records manual-start metadata supplied by the caller", async () => {
  const { models, attemptCreates } = makeExecModels([
    installedEdge("mybot"),
  ]);

  await triggerPluginRunsForDownloadableFile(
    { downloadableFileId: "f-1", event: EVENT, models },
    {
      loadPlugin: loaderFor(
        pluginReturning({ success: true, result: { message: "ok" } })
      ),
      execution: {
        pipelineId: "manual-pipeline-1",
        trigger: PluginPipelineRunTrigger.OwnerStart,
        initiatedByUsername: "alice",
        retryOfPipelineRunId: "previous-pipeline",
      },
    }
  );

  assert.deepEqual(
    {
      pipelineId: attemptCreates[0]!.input[0]!.pipelineId,
      trigger: attemptCreates[0]!.input[0]!.trigger,
      initiatedByUsername: attemptCreates[0]!.input[0]!.initiatedByUsername,
      retryOfPipelineRunId:
        attemptCreates[0]!.input[0]!.retryOfPipelineRunId,
    },
    {
      pipelineId: "manual-pipeline-1",
      trigger: "OWNER_START",
      initiatedByUsername: "alice",
      retryOfPipelineRunId: "previous-pipeline",
    }
  );
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
  type AttachmentEvent = {
    payload: { attachmentUrls: string[] };
  };
  let receivedEvent!: AttachmentEvent;
  const Plugin = class {
    async handleEvent(event: unknown) {
      receivedEvent = event as AttachmentEvent;
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

  await execRun(
    models,
    loaderFor(Plugin),
    storage as unknown as StorageStub
  );

  const completedPayload = JSON.parse(
    String(
      updates.find(update => update.update?.status === "SUCCEEDED")
        ?.update?.payload
    )
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
  const loader: LoadPlugin = async () => {
    n += 1;
    if (n === 1) throw new Error("load boom");
    return pluginReturning({ success: true });
  };
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
      scanCheckedAt: fileUpdates[1]!.update?.scanCheckedAt,
    },
  });
});

test("marks the downloadable file failed when the scanner throws", async () => {
  const { models, fileUpdates } = makeExecModels([
    installedEdge("security-attachment-scan"),
  ]);
  await execRun(
    models,
    async () => {
      throw new Error("scan service unavailable");
    }
  );

  assert.deepEqual(fileUpdates[1], {
    where: { id: "f-1" },
    update: {
      scanStatus: "FAILED",
      scanReason: "scan service unavailable",
      scanCheckedAt: fileUpdates[1]!.update?.scanCheckedAt,
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

  assert.equal(fileUpdates[0]!.update?.scanStatus, "PENDING");
});

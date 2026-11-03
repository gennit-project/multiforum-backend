import type { PluginPipelineRun, DownloadableFile, Channel, ServerConfig, PluginRun, ServerSecret } from "../../src/generated/graphql.js";
import type { Selection, Projection } from "./selection.js";

export const rerunSourceSelection = {
  "pipelineId": true,
  "targetId": true,
  "targetType": true,
  "targetVersion": true,
  "eventType": true,
  "scope": true,
  "channelId": true,
  "status": true,
  "trigger": true,
  "createdAt": true
} as const satisfies Selection<PluginPipelineRun>;
export type RerunSourceAttempt = Projection<PluginPipelineRun, typeof rerunSourceSelection>;

export const fileVersionSelection = {
  "uploadedAt": true,
  "createdAt": true
} as const satisfies Selection<DownloadableFile>;
export type FileVersion = Projection<DownloadableFile, typeof fileVersionSelection>;

export const rerunRelatedSelection = {
  "pipelineId": true,
  "status": true,
  "trigger": true,
  "createdAt": true
} as const satisfies Selection<PluginPipelineRun>;
export type RerunRelatedAttempt = Projection<PluginPipelineRun, typeof rerunRelatedSelection>;

export const startFileSelection = {
  "id": true,
  "uploadedAt": true,
  "createdAt": true,
  "uploadedByUsername": true,
  "Discussion": {
    "Author": {
      "username": true
    },
    "DiscussionChannels": {
      "channelUniqueName": true,
      "archived": true
    }
  }
} as const satisfies Selection<DownloadableFile>;
export type StartFileTarget = Projection<DownloadableFile, typeof startFileSelection>;

export const startChannelSelection = {
  "uniqueName": true,
  "pluginPipelines": true
} as const satisfies Selection<Channel>;
export type StartChannelPlan = Projection<Channel, typeof startChannelSelection>;

export const startServerSelection = {
  "pluginPipelines": true,
  "InstalledVersionsConnection": {
    "edges": {
      "properties": {
        "enabled": true,
        "settingsJson": true
      },
      "node": {
        "id": true,
        "version": true,
        "repoUrl": true,
        "tarballGsUri": true,
        "entryPath": true,
        "manifest": true,
        "settingsDefaults": true,
        "uiSchema": true,
        "Plugin": {
          "id": true,
          "name": true,
          "displayName": true,
          "description": true,
          "metadata": true
        }
      }
    }
  }
} as const satisfies Selection<ServerConfig>;
export type StartServerPlan = Projection<ServerConfig, typeof startServerSelection>;

export const activeAttemptSelection = {
  "pipelineId": true
} as const satisfies Selection<PluginPipelineRun>;
export type ActiveAttempt = Projection<PluginPipelineRun, typeof activeAttemptSelection>;

export const startedAttemptSelection = {
  "pipelineId": true,
  "targetId": true,
  "targetType": true,
  "targetVersion": true,
  "eventType": true,
  "scope": true,
  "channelId": true,
  "status": true,
  "trigger": true,
  "initiatedByUsername": true,
  "retryOfPipelineRunId": true,
  "attemptNumber": true,
  "configurationSnapshot": true,
  "applicability": true,
  "policyEffectiveAt": true,
  "policyId": true,
  "campaignId": true,
  "queuedAt": true,
  "startedAt": true,
  "heartbeatAt": true,
  "timeoutAt": true,
  "finishedAt": true,
  "createdAt": true,
  "updatedAt": true
} as const satisfies Selection<PluginPipelineRun>;
export type StartedAttempt = Projection<PluginPipelineRun, typeof startedAttemptSelection>;

export const retryTargetSelection = {
  "uploadedByUsername": true,
  "scanStatus": true,
  "Discussion": {
    "id": true,
    "Author": {
      "username": true
    },
    "DiscussionChannels": {
      "channelUniqueName": true,
      "archived": true
    }
  }
} as const satisfies Selection<DownloadableFile>;
export type RetryScanTarget = Projection<DownloadableFile, typeof retryTargetSelection>;

export const retryFailedSelection = {
  "pipelineId": true,
  "createdAt": true
} as const satisfies Selection<PluginPipelineRun>;
export type RetryFailedAttempt = Projection<PluginPipelineRun, typeof retryFailedSelection>;

export const returnedJobSelection = {
  "id": true,
  "pluginId": true,
  "pluginName": true,
  "version": true,
  "scope": true,
  "channelId": true,
  "eventType": true,
  "status": true,
  "message": true,
  "durationMs": true,
  "targetId": true,
  "targetType": true,
  "payload": true,
  "pipelineId": true,
  "executionOrder": true,
  "skippedReason": true,
  "createdAt": true,
  "updatedAt": true
} as const satisfies Selection<PluginRun>;
export type ReturnedJob = Projection<PluginRun, typeof returnedJobSelection>;

export const downloadTriggerFileSelection = {
  "id": true,
  "fileName": true,
  "url": true,
  "kind": true,
  "size": true,
  "uploadedAt": true,
  "createdAt": true,
  "storageBucket": true,
  "storageObjectName": true,
  "Discussion": {
    "id": true,
    "title": true,
    "body": true,
    "DiscussionChannels": {
      "channelUniqueName": true,
      "Channel": {
        "uniqueName": true,
        "displayName": true,
        "description": true,
        "rules": true
      }
    }
  }
} as const satisfies Selection<DownloadableFile>;
export type DownloadTriggerFile = Projection<DownloadableFile, typeof downloadTriggerFileSelection>;

export const downloadTriggerConfigSelection = {
  "serverName": true,
  "pluginPipelines": true,
  "InstalledVersionsConnection": {
    "edges": {
      "properties": {
        "enabled": true,
        "settingsJson": true
      },
      "node": {
        "id": true,
        "version": true,
        "repoUrl": true,
        "tarballGsUri": true,
        "entryPath": true,
        "manifest": true,
        "settingsDefaults": true,
        "uiSchema": true,
        "Plugin": {
          "id": true,
          "name": true,
          "displayName": true,
          "description": true,
          "metadata": true
        }
      }
    }
  }
} as const satisfies Selection<ServerConfig>;
export type DownloadTriggerConfig = Projection<ServerConfig, typeof downloadTriggerConfigSelection>;

export const downloadTriggerSecretSelection = {
  "key": true,
  "ciphertext": true
} as const satisfies Selection<ServerSecret>;
export type DownloadTriggerSecret = Projection<ServerSecret, typeof downloadTriggerSecretSelection>;

export const pendingJobSelection = {
  "id": true,
  "pluginId": true,
  "pluginName": true,
  "version": true,
  "scope": true,
  "channelId": true,
  "eventType": true,
  "status": true,
  "message": true,
  "durationMs": true,
  "targetId": true,
  "targetType": true,
  "targetVersion": true,
  "retryCount": true,
  "nextAttemptAt": true,
  "pipelineId": true,
  "executionOrder": true,
  "skippedReason": true,
  "leaseId": true,
  "payload": true,
  "publicDiagnostics": true,
  "queuedAt": true,
  "startedAt": true,
  "heartbeatAt": true,
  "timeoutAt": true,
  "finishedAt": true,
  "createdAt": true,
  "updatedAt": true
} as const satisfies Selection<PluginRun>;
export type PendingJob = Projection<PluginRun, typeof pendingJobSelection>;

// These fixed queries currently fail GraphQL validation because the schema
// exposes plural DownloadableFiles. Retain the attempted projection without
// asserting that it is a valid generated Discussion result. Tests preserve that failure.
export type RerunDiscussionVersion = { DownloadableFile: FileVersion | null };
export type StartDiscussionTarget = { id: string; Author: { username: string } | null; DownloadableFile: (FileVersion & {uploadedByUsername: string | null}) | null; DiscussionChannels: {channelUniqueName: string; archived: boolean | null}[] };

export type PendingRuns = {pluginRuns: PendingJob[]};

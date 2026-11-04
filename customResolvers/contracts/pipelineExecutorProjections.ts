import type {Channel,Comment,Discussion,DownloadableFile,PluginRun,ServerConfig,ServerSecret,User,ModerationProfile} from '../../src/generated/graphql.js';
import type {Selection,Projection} from './selection.js';

// Fixed schema-executed selections. JSON scalar contents remain unrestricted.
export const channelExecutionChannelSelection = {
  "uniqueName": true,
  "displayName": true,
  "description": true,
  "rules": true,
  "pluginPipelines": true,
  "Tags": {
    "text": true
  },
  "FilterGroups": {
    "id": true,
    "key": true,
    "displayName": true,
    "mode": true,
    "order": true,
    "options": {
      "id": true,
      "value": true,
      "displayName": true,
      "order": true
    }
  },
  "EnabledPluginsConnection": {
    "edges": {
      "properties": {
        "enabled": true,
        "settingsJson": true
      },
      "node": {
        "id": true,
        "version": true,
        "Plugin": {
          "id": true,
          "name": true
        }
      }
    }
  }
} as const satisfies Selection<Channel>;
export type ChannelExecutionChannel = Projection<Channel,typeof channelExecutionChannelSelection>;

export const commentExecutionChannelSelection = {
  "uniqueName": true,
  "displayName": true,
  "description": true,
  "rules": true,
  "pluginPipelines": true,
  "EnabledPluginsConnection": {
    "edges": {
      "properties": {
        "enabled": true,
        "settingsJson": true
      },
      "node": {
        "id": true,
        "version": true,
        "Plugin": {
          "id": true,
          "name": true
        }
      }
    }
  }
} as const satisfies Selection<Channel>;
export type CommentExecutionChannel = Projection<Channel,typeof commentExecutionChannelSelection>;

export const channelExecutionDiscussionSelection = {
  "id": true,
  "title": true,
  "body": true,
  "Author": {
    "username": true,
    "isBot": true
  },
  "DownloadableFiles": {
    "id": true,
    "fileName": true,
    "url": true,
    "kind": true,
    "size": true,
    "uploadedAt": true,
    "createdAt": true,
    "storageBucket": true,
    "storageObjectName": true
  }
} as const satisfies Selection<Discussion>;
export type ChannelExecutionDiscussion = Projection<Discussion,typeof channelExecutionDiscussionSelection>;

export const commentExecutionCommentCoreSelection = {
  "id": true,
  "text": true,
  "botMentions": true,
  "isFeedbackComment": true,
  "createdAt": true,
  "DiscussionChannel": {
    "id": true,
    "discussionId": true,
    "channelUniqueName": true,
    "Discussion": {
      "id": true,
      "title": true,
      "body": true
    }
  },
  "Channel": {
    "uniqueName": true,
    "displayName": true,
    "description": true,
    "rules": true
  },
  "Event": {
    "id": true,
    "title": true,
    "EventChannels": {
      "channelUniqueName": true
    }
  },
  "Issue": {
    "id": true
  },
  "ParentComment": {
    "id": true
  }
} as const satisfies Selection<Comment>;
export const commentExecutionUserSelection = {
  "username": true,
  "displayName": true,
  "isBot": true
} as const satisfies Selection<User>;
export const commentExecutionModSelection = {
  "displayName": true,
  "User": {
    "username": true
  }
} as const satisfies Selection<ModerationProfile>;
export const commentExecutionCommentSelection = {...commentExecutionCommentCoreSelection,CommentAuthor:{'... on User':commentExecutionUserSelection,'... on ModerationProfile':commentExecutionModSelection}} as const;
export type CommentExecutionComment = Projection<Comment,typeof commentExecutionCommentCoreSelection> & {CommentAuthor:(Projection<User,typeof commentExecutionUserSelection> & {User?:never}) | (Projection<ModerationProfile,typeof commentExecutionModSelection> & {username?:never;isBot?:never}) | null};

export const executionConfigurationSelection = {
  "serverName": true,
  "rules": true,
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
export type ExecutionConfiguration = Projection<ServerConfig,typeof executionConfigurationSelection>;

export const executionReturnedRunSelection = {
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
export type ExecutionReturnedRun = Projection<PluginRun,typeof executionReturnedRunSelection>;

export const executionSecretSelection = {
  "key": true,
  "ciphertext": true
} as const satisfies Selection<ServerSecret>;
export type ExecutionSecret = Projection<ServerSecret,typeof executionSecretSelection>;

export const executionPendingRunSelection = {
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
export type ExecutionPendingRun = Projection<PluginRun,typeof executionPendingRunSelection>;

export const executionFileWriteSelection = {
  "id": true,
  "fileName": true,
  "size": true,
  "url": true,
  "storageBucket": true,
  "storageObjectName": true,
  "storageUrl": true,
  "uploadedByUsername": true,
  "uploadedByIp": true,
  "permanentlyRemoved": true,
  "permanentlyRemovedByUsername": true,
  "permanentlyRemovedByModName": true,
  "priceCents": true,
  "priceCurrency": true,
  "stripeProductId": true,
  "stripePriceId": true,
  "downloadCountTotal": true,
  "downloadCountUnique": true,
  "attributionOverride": true,
  "supportPatreonUrl": true,
  "supportBuyMeACoffeeUrl": true,
  "supportKoFiUrl": true,
  "supportPayPalMeUrl": true,
  "scanReason": true,
  "reviewRequestReason": true,
  "reviewRequestedByUsername": true,
  "kind": true,
  "priceModel": true,
  "scanStatus": true,
  "uploadedAt": true,
  "createdAt": true,
  "permanentlyRemovedAt": true,
  "paywallExpiresAt": true,
  "scanCheckedAt": true,
  "reviewRequestedAt": true
} as const satisfies Selection<DownloadableFile>;
export type ExecutionFileWrite = Projection<DownloadableFile,typeof executionFileWriteSelection>;

// The real query selects the plural relationship. Isolated injected adapters
// still support the legacy singular attachment shape; do not assert a full file.
export type ChannelDiscussionExecutionSource = Omit<ChannelExecutionDiscussion,'DownloadableFiles'> & {
 DownloadableFiles?: ChannelExecutionDiscussion['DownloadableFiles'] | null;
 DownloadableFile?: ChannelExecutionDiscussion['DownloadableFiles'][number] | null;
};

export type CreatedExecutionRuns = {pluginRuns:ExecutionPendingRun[]};

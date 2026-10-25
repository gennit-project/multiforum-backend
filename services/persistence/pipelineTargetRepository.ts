import type { Driver } from "neo4j-driver";
import type { PluginEdgeData } from "../plugin/types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type PipelineDiscussionSnapshot = {
  id: string;
  deleted?: boolean | null;
  DownloadableFiles?: Array<{ id?: string; permanentlyRemoved?: boolean | null }>;
  DiscussionChannels?: Array<{ archived?: boolean | null }>;
};
export type PipelineDownloadSnapshot = {
  id: string;
  permanentlyRemoved?: boolean | null;
  Discussion?: {
    id?: string;
    deleted?: boolean | null;
    DiscussionChannels?: Array<{ channelUniqueName?: string | null; archived?: boolean | null }>;
  } | null;
};
export type PipelineDownloadTiming = { id: string; uploadedAt?: string | null; createdAt: string };
export type ServerApplicabilityConfig = {
  pluginPipelines?: unknown;
  InstalledVersionsConnection?: { edges?: PluginEdgeData[] };
};
export type ChannelApplicabilityConfig = { uniqueName: string; pluginPipelines?: unknown };

export interface PipelineTargetRepository {
  findDiscussionVisibility(id: string): Promise<PipelineDiscussionSnapshot[]>;
  findDownloadVisibility(id: string): Promise<PipelineDownloadSnapshot[]>;
  findDownloadTiming(id: string): Promise<PipelineDownloadTiming[]>;
  listServerApplicabilityConfigs(): Promise<ServerApplicabilityConfig[]>;
  findChannelApplicabilityConfig(uniqueName: string): Promise<ChannelApplicabilityConfig[]>;
}

const DISCUSSION_VISIBILITY = `query PublicPipelineDiscussionTarget($where: DiscussionWhere) { discussions(where: $where) {
        id
        deleted
        DownloadableFiles {
          id
          permanentlyRemoved
        }
        DiscussionChannels {
          archived
        }
      } }`;

const DOWNLOAD_VISIBILITY = `query PublicPipelineDownloadTarget($where: DownloadableFileWhere) { downloadableFiles(where: $where) {
        id
        permanentlyRemoved
        Discussion {
          id
          deleted
          DiscussionChannels {
            channelUniqueName
            archived
          }
        }
      } }`;

const DOWNLOAD_TIMING = `query PipelineDownloadTiming($where: DownloadableFileWhere) { downloadableFiles(where: $where) { id uploadedAt createdAt } }`;

const SERVER_APPLICABILITY = `query ServerPipelineApplicability { serverConfigs {
      pluginPipelines
      InstalledVersionsConnection {
        edges {
          properties { enabled settingsJson }
          node {
            id version repoUrl tarballGsUri entryPath manifest
            settingsDefaults uiSchema
            Plugin {
              id name displayName description metadata
            }
          }
        }
      }
    } }`;

const CHANNEL_APPLICABILITY = `query ChannelPipelineApplicability($where: ChannelWhere) { channels(where: $where) { uniqueName pluginPipelines } }`;

/** Fixed public visibility and applicability snapshots with generated-schema filtering. */
export function createPipelineTargetRepository(driver: Driver): PipelineTargetRepository {
  return {
    async findDiscussionVisibility(id) {
      const data = await executeGeneratedOperation<{ discussions: PipelineDiscussionSnapshot[] }>(driver, DISCUSSION_VISIBILITY, { where: { id: { eq: id } } });
      return data.discussions;
    },
    async findDownloadVisibility(id) {
      const data = await executeGeneratedOperation<{ downloadableFiles: PipelineDownloadSnapshot[] }>(driver, DOWNLOAD_VISIBILITY, { where: { id: { eq: id } } });
      return data.downloadableFiles;
    },
    async findDownloadTiming(id) {
      const data = await executeGeneratedOperation<{ downloadableFiles: PipelineDownloadTiming[] }>(driver, DOWNLOAD_TIMING, { where: { id: { eq: id } } });
      return data.downloadableFiles;
    },
    async listServerApplicabilityConfigs() {
      const data = await executeGeneratedOperation<{ serverConfigs: ServerApplicabilityConfig[] }>(driver, SERVER_APPLICABILITY, {});
      return data.serverConfigs;
    },
    async findChannelApplicabilityConfig(uniqueName) {
      const data = await executeGeneratedOperation<{ channels: ChannelApplicabilityConfig[] }>(driver, CHANNEL_APPLICABILITY, { where: { uniqueName: { eq: uniqueName } } });
      return data.channels;
    },
  };
}

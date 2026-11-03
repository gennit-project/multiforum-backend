import type { Channel, ServerConfig, Discussion, DownloadableFile } from "../../src/generated/graphql.js";
import type { Projection, Selection } from "./selection.js";

type CheckedProjection<T, S extends Selection<T>> = Projection<T, S>;
type SettingsProperties = { enabled: true; settingsJson: true };
type BotPlugin = { name: true; tags: true };
export type ChannelPipelineSettings = CheckedProjection<Channel, {
  uniqueName: true; pluginPipelines: true; Bots: { username: true };
  EnabledPluginsConnection: { edges: { properties: SettingsProperties; node: { settingsDefaults: true; Plugin: BotPlugin } } };
}>;
export type ServerBotPipelineSettings = CheckedProjection<ServerConfig, {
  serverName: true;
  InstalledVersionsConnection: { edges: { properties: SettingsProperties; node: { version: true; settingsDefaults: true; Plugin: BotPlugin } } };
}>;
export type ServerPipelineSettings = CheckedProjection<ServerConfig, { serverName: true; pluginPipelines: true }>;
export type PipelineDiscussionSnapshot = CheckedProjection<Discussion, {
  id: true; deleted: true; DownloadableFiles: { id: true; permanentlyRemoved: true }; DiscussionChannels: { archived: true };
}>;
export type PipelineDownloadSnapshot = CheckedProjection<DownloadableFile, {
  id: true; permanentlyRemoved: true;
  Discussion: { id: true; deleted: true; DiscussionChannels: { channelUniqueName: true; archived: true } };
}>;
export type PipelineDownloadTiming = CheckedProjection<DownloadableFile, { id: true; uploadedAt: true; createdAt: true }>;
export type ServerApplicabilityConfig = CheckedProjection<ServerConfig, {
  pluginPipelines: true;
  InstalledVersionsConnection: { edges: { properties: SettingsProperties; node: {
    id: true; version: true; repoUrl: true; tarballGsUri: true; entryPath: true; manifest: true; settingsDefaults: true; uiSchema: true;
    Plugin: { id: true; name: true; displayName: true; description: true; metadata: true };
  } } };
}>;
export type ChannelApplicabilityConfig = CheckedProjection<Channel, { uniqueName: true; pluginPipelines: true }>;

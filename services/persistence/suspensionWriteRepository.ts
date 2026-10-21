import type { Driver } from "neo4j-driver";
import type { IssueUpdateInput, ChannelUpdateInput, ServerConfigUpdateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { ISSUE_ACTIVITY_DEFAULT_SELECTION } from "./issueActivityRepository.js";
import { assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";

type IssueResult = { issues: Array<{id: string; issueNumber?: number | null; ActivityFeed: Array<{id: string; actionType?: string | null}>}> };
export interface SuspensionWriteRepository {
  appendSuspensionActivity(id: string, update: IssueUpdateInput): Promise<void>;
  closeSuspensionIssue(id: string, update: IssueUpdateInput): Promise<IssueResult>;
  addChannelSuspension(uniqueName: string | null | undefined, update: ChannelUpdateInput): Promise<{channels: Array<{uniqueName: string}>}>;
  addServerSuspension(serverName: string | undefined, update: ServerConfigUpdateInput): Promise<{serverConfigs: Array<{serverName?: string | null}>}>;
  removeChannelSuspensions(uniqueName: string | null | undefined, update: ChannelUpdateInput): Promise<void>;
  removeServerSuspensions(serverName: string | undefined, update: ServerConfigUpdateInput): Promise<void>;
}
export const SUSPENSION_ISSUE_SELECTION = `{ issues { id issueNumber ActivityFeed { id actionType } } }`;
// These projections retain the production reused-schema OGM default response/error contracts.
export const SUSPENSION_CHANNEL_DEFAULT_SELECTION = `{
  uniqueName
  displayName
  description
  locked
  lockReason
  deleted
  channelIconURL
  icon32Url
  icon48Url
  icon64Url
  icon96Url
  channelBannerURL
  eventsEnabled
  wikiEnabled
  feedbackEnabled
  downloadsEnabled
  emojiEnabled
  imageUploadsEnabled
  markdownImagesEnabled
  allowPaidDownloads
  allowPaywalledPosts
  requireVerifiedPhoneForUploads
  requireVerifiedEmailToPost
  markAsAnsweredEnabled
  discussionFlairRequired
  allowedFileTypes
  payoutPercent
  variantUrls
  rules
  pluginPipelines
  createdAt
  lockedAt
}`;
export const SUSPENSION_SERVER_DEFAULT_SELECTION = `{
  serverName
  serverDescription
  serverIconURL
  allowedFileTypes
  featuredWikiPageIds
  enableDownloads
  enableEvents
  accountAgeGateEnabled
  minimumAccountAge
  sensitiveContentAgeGateEnabled
  minimumSensitiveContentAge
  brandingProductName
  brandingDocsURL
  brandingSourceURL
  brandingIssuesURL
  brandingSupportEmail
  brandingShowUpstreamLinks
  brandingLogoDarkURL
  brandingLogoAlt
  brandingFaviconURL
  brandingPrimaryColor
  pluginRegistries
  rules
  brandingCustomFooterLinks
  pluginPipelines
}`;
const APPEND = `mutation AppendSuspensionActivity($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where:$where, update:$update) { issues ${ISSUE_ACTIVITY_DEFAULT_SELECTION} } }`;
const CLOSE = `mutation CloseSuspensionIssue($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where:$where, update:$update) ${SUSPENSION_ISSUE_SELECTION} }`;
const ADD_CHANNEL = `mutation AddChannelSuspension($where: ChannelWhere, $update: ChannelUpdateInput) { updateChannels(where:$where, update:$update) { channels { uniqueName } } }`;
const ADD_SERVER = `mutation AddServerSuspension($where: ServerConfigWhere, $update: ServerConfigUpdateInput) { updateServerConfigs(where:$where, update:$update) { serverConfigs { serverName } } }`;
const REMOVE_CHANNEL = `mutation RemoveChannelSuspensions($where: ChannelWhere, $update: ChannelUpdateInput) { updateChannels(where:$where, update:$update) { channels ${SUSPENSION_CHANNEL_DEFAULT_SELECTION} } }`;
const REMOVE_SERVER = `mutation RemoveServerSuspensions($where: ServerConfigWhere, $update: ServerConfigUpdateInput) { updateServerConfigs(where:$where, update:$update) { serverConfigs ${SUSPENSION_SERVER_DEFAULT_SELECTION} } }`;
export function createSuspensionWriteRepository(driver: Driver): SuspensionWriteRepository {
  return {
    async appendSuspensionActivity(id,update) { assertIssueIdentityUpdateAllowed(update); await executeGeneratedOperation(driver,APPEND,{where:{id},update}); },
    async closeSuspensionIssue(id,update) { assertIssueIdentityUpdateAllowed(update); return (await executeGeneratedOperation<{updateIssues:IssueResult}>(driver,CLOSE,{where:{id},update})).updateIssues; },
    async addChannelSuspension(uniqueName,update) { return (await executeGeneratedOperation<{updateChannels:{channels:Array<{uniqueName:string}>}}>(driver,ADD_CHANNEL,{where:{uniqueName},update})).updateChannels; },
    async addServerSuspension(serverName,update) { return (await executeGeneratedOperation<{updateServerConfigs:{serverConfigs:Array<{serverName?:string|null}>}}>(driver,ADD_SERVER,{where:{serverName},update})).updateServerConfigs; },
    async removeChannelSuspensions(uniqueName,update) { await executeGeneratedOperation(driver,REMOVE_CHANNEL,{where:{uniqueName},update}); },
    async removeServerSuspensions(serverName,update) { await executeGeneratedOperation(driver,REMOVE_SERVER,{where:{serverName},update}); },
  };
}

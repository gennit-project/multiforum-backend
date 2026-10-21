import type {Driver} from "neo4j-driver";
import type {ModChannelRoleCreateInput,ChannelRoleCreateInput,ModServerRoleCreateInput,ServerRoleCreateInput,ServerConfigCreateInput,ChannelCreateInput,TagCreateInput,CommentCreateInput} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export interface SeedDataRepository {
 createModChannelRoles(input:ModChannelRoleCreateInput[]):Promise<void>;
 createChannelRoles(input:ChannelRoleCreateInput[]):Promise<void>;
 createModServerRoles(input:ModServerRoleCreateInput[]):Promise<void>;
 createServerRoles(input:ServerRoleCreateInput[]):Promise<void>;
 createServerConfigs(input:ServerConfigCreateInput[]):Promise<void>;
 connectDefaultRoles():Promise<void>;
 createChannels(input:ChannelCreateInput[]):Promise<void>;
 createTags(input:TagCreateInput[]):Promise<void>;
 createComments(input:CommentCreateInput[]):Promise<void>;
}
export const SEED_MODCHANNELROLE_SELECTION = `{
  id
  name
  channelUniqueName
  description
  canHideComment
  canHideEvent
  canHideDiscussion
  canEditComments
  canEditDiscussions
  canEditEvents
  canGiveFeedback
  canOpenSupportTickets
  canCloseSupportTickets
  canReport
  canSuspendUser
  canArchiveImage
  canDeleteWiki
}`;
export const SEED_CHANNELROLE_SELECTION = `{
  id
  name
  channelUniqueName
  description
  canCreateDiscussion
  canCreateEvent
  canCreateComment
  canUpvoteDiscussion
  canUpvoteComment
  canUploadFile
  canUpdateChannel
}`;
export const SEED_MODSERVERROLE_SELECTION = `{
  name
  description
  canLockChannel
  canHideComment
  canHideEvent
  canHideDiscussion
  canEditComments
  canEditDiscussions
  canEditEvents
  canGiveFeedback
  canOpenSupportTickets
  canCloseSupportTickets
  canReport
  canSuspendUser
  canArchiveImage
  canDeleteWiki
  canPermanentlyRemoveImage
  canRemoveDiscussionChannel
  canRemoveEventChannel
}`;
export const SEED_SERVERROLE_SELECTION = `{
  name
  description
  canCreateChannel
  canCreateDiscussion
  canCreateEvent
  canCreateComment
  canUpvoteDiscussion
  canUpvoteComment
  canUploadFile
  canGiveFeedback
  canManageServerSettings
  canManagePlugins
  canManageRoles
  canManageMods
  canManageAdmins
  canManageSuperAdmins
}`;
export const SEED_SERVERCONFIG_SELECTION = `{
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
export const SEED_CHANNEL_SELECTION = `{
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
export const SEED_TAG_SELECTION = `{
  text
}`;
export const SEED_COMMENT_SELECTION = `{
  id
  text
  editReason
  isRootComment
  isFeedbackComment
  deleted
  archived
  isSticky
  stickyByUsername
  weightedVotesCount
  botMentions
  isFavoritedByUser
  emoji
  stickyAt
  updatedAt
  textLastEdited
  createdAt
}`;
export function createSeedDataRepository(driver:Driver):SeedDataRepository {return {
 async createModChannelRoles(input){await executeGeneratedOperation(driver,`mutation SeedModChannelRole($input:[ModChannelRoleCreateInput!]!){createModChannelRoles(input:$input){modChannelRoles${SEED_MODCHANNELROLE_SELECTION}}}`,{input});},
 async createChannelRoles(input){await executeGeneratedOperation(driver,`mutation SeedChannelRole($input:[ChannelRoleCreateInput!]!){createChannelRoles(input:$input){channelRoles${SEED_CHANNELROLE_SELECTION}}}`,{input});},
 async createModServerRoles(input){await executeGeneratedOperation(driver,`mutation SeedModServerRole($input:[ModServerRoleCreateInput!]!){createModServerRoles(input:$input){modServerRoles${SEED_MODSERVERROLE_SELECTION}}}`,{input});},
 async createServerRoles(input){await executeGeneratedOperation(driver,`mutation SeedServerRole($input:[ServerRoleCreateInput!]!){createServerRoles(input:$input){serverRoles${SEED_SERVERROLE_SELECTION}}}`,{input});},
 async createServerConfigs(input){await executeGeneratedOperation(driver,`mutation SeedServerConfig($input:[ServerConfigCreateInput!]!){createServerConfigs(input:$input){serverConfigs${SEED_SERVERCONFIG_SELECTION}}}`,{input});},
 async connectDefaultRoles(){await executeGeneratedOperation(driver,`mutation SeedDefaultRoles($where:ServerConfigWhere,$update:ServerConfigUpdateInput){updateServerConfigs(where:$where,update:$update){serverConfigs${SEED_SERVERCONFIG_SELECTION}}}`,{where:{ serverName: "Cypress Test Server" },update:{
          DefaultServerRole: {
            connect: {
              where: {
                node: { name: "CanCreateAnything" },
              },
              overwrite: true,
            },
          },
          DefaultSuspendedRole: {
            connect: {
              where: {
                node: { name: "Suspended Role" },
              },
              overwrite: true,
            },
          },
          DefaultElevatedModRole: {
            connect: {
              where: {
                node: {
                  name: "DefaultElevatedModRole"
                },
              },
              overwrite: true,
            }
          },
          DefaultModRole: {
            connect: {
              where: {
                node: {
                  name: "BasicModRole"
                }
              }
            }
          },
          DefaultSuspendedModRole: {
            connect: {
              where: {
                node: {
                  name: "DefaultSuspendedModRole"
                }
              }
            }
          }
        }});},
 async createChannels(input){await executeGeneratedOperation(driver,`mutation SeedChannel($input:[ChannelCreateInput!]!){createChannels(input:$input){channels${SEED_CHANNEL_SELECTION}}}`,{input});},
 async createTags(input){await executeGeneratedOperation(driver,`mutation SeedTag($input:[TagCreateInput!]!){createTags(input:$input){tags${SEED_TAG_SELECTION}}}`,{input});},
 async createComments(input){await executeGeneratedOperation(driver,`mutation SeedComment($input:[CommentCreateInput!]!){createComments(input:$input){comments${SEED_COMMENT_SELECTION}}}`,{input});},
};}

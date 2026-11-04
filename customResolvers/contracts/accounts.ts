import { createdDiscussionSelection } from "./contentProjections.js";
import { publicCollectionSelection, profileImageSelection, channelIconSelection } from "./accountProjections.js";
import type { MutationResolvers, QueryResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { SelectedResolver } from "./selection.js";

// Scalar responses are checked against the complete generated field signature.
// No database entity is certified merely because a mutation returns Boolean.
export const accountScalarMutationNames = [
  "acceptForumModInvite", "acceptForumOwnerInvite", "acceptServerAdminInvite", "acceptServerModInvite",
  "cancelInviteForumMod", "cancelInviteForumOwner", "cancelInviteServerAdmin", "cancelInviteServerMod",
  "inviteForumMod", "inviteForumOwner", "inviteServerAdmin", "inviteServerMod",
  "removeForumMod", "removeForumOwner", "becomeForumAdmin", "addToCollection", "removeFromCollection", "reorderCollectionItem",
  "deleteScratchpadEntry", "sendBugReport",
] as const;
export type AccountScalarMutationResolvers = Required<Pick<MutationResolvers<GraphQLContext>, typeof accountScalarMutationNames[number]>>;

export const accountObjectMutationNames = ["shareCollectionAsDiscussion", "dropDataForCypressTests", "seedDataForCypressTests", "setRankingSettings", "createEmailAndUser", "updateScratchpadEntryVisibility", "setProfileImage", "setChannelIcon"] as const;
const testDataSelection = { success: true, message: true } as const;
export const scratchpadSelection = { id: true, text: true, isPublic: true, sourceType: true, sourceId: true, sourceChannelUniqueName: true, discussionId: true, createdAt: true } as const;
export type AccountObjectMutationResolvers = {
  shareCollectionAsDiscussion: SelectedResolver<MutationResolvers<GraphQLContext>["shareCollectionAsDiscussion"], typeof createdDiscussionSelection>;
  setProfileImage: SelectedResolver<MutationResolvers<GraphQLContext>["setProfileImage"], typeof profileImageSelection>;
  setChannelIcon: SelectedResolver<MutationResolvers<GraphQLContext>["setChannelIcon"], typeof channelIconSelection>;
  dropDataForCypressTests: SelectedResolver<MutationResolvers<GraphQLContext>["dropDataForCypressTests"], typeof testDataSelection>;
  seedDataForCypressTests: SelectedResolver<MutationResolvers<GraphQLContext>["seedDataForCypressTests"], typeof testDataSelection>;
  setRankingSettings: NonNullable<MutationResolvers<GraphQLContext>["setRankingSettings"]>;
  createEmailAndUser: SelectedResolver<MutationResolvers<GraphQLContext>["createEmailAndUser"], { username: true }>;
  updateScratchpadEntryVisibility: SelectedResolver<MutationResolvers<GraphQLContext>["updateScratchpadEntryVisibility"], typeof scratchpadSelection>;
};
export const accountQueryNames = ["getAgePolicy", "getInstanceSetupStatus", "getOwnEmail", "getRankingSettings"] as const;
export type AccountQueryResolvers = Required<Pick<QueryResolvers<GraphQLContext>, typeof accountQueryNames[number]>>;

export const accountCollectionQueryNames = ["publicCollectionsContaining"] as const;
export type AccountCollectionQueryResolvers = {
  publicCollectionsContaining: SelectedResolver<QueryResolvers<GraphQLContext>["publicCollectionsContaining"], typeof publicCollectionSelection>;
};

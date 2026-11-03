import setProfileImage from "../../customResolvers/mutations/setProfileImage.js";
import setChannelIcon from "../../customResolvers/mutations/setChannelIcon.js";
import publicCollectionsContaining from "../../customResolvers/queries/publicCollectionsContaining.js";
// Compile-only implementation and negative boundary fixtures.
import type { AccountScalarMutationResolvers, AccountObjectMutationResolvers, AccountQueryResolvers, AccountCollectionQueryResolvers } from "../../customResolvers/contracts/accounts.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import acceptForumModInvite from "../../customResolvers/mutations/acceptForumModInvite.js";
import acceptForumOwnerInvite from "../../customResolvers/mutations/acceptForumOwnerInvite.js";
import acceptServerAdminInvite from "../../customResolvers/mutations/acceptServerAdminInvite.js";
import acceptServerModInvite from "../../customResolvers/mutations/acceptServerModInvite.js";
import cancelInviteForumMod from "../../customResolvers/mutations/cancelInviteForumMod.js";
import cancelInviteForumOwner from "../../customResolvers/mutations/cancelInviteForumOwner.js";
import cancelInviteServerAdmin from "../../customResolvers/mutations/cancelInviteServerAdmin.js";
import cancelInviteServerMod from "../../customResolvers/mutations/cancelInviteServerMod.js";
import inviteForumMod from "../../customResolvers/mutations/inviteForumMod.js";
import inviteForumOwner from "../../customResolvers/mutations/inviteForumOwner.js";
import inviteServerAdmin from "../../customResolvers/mutations/inviteServerAdmin.js";
import inviteServerMod from "../../customResolvers/mutations/inviteServerMod.js";
import removeForumMod from "../../customResolvers/mutations/removeForumMod.js";
import removeForumOwner from "../../customResolvers/mutations/removeForumOwner.js";
import becomeForumAdmin from "../../customResolvers/mutations/becomeForumAdmin.js";
import deleteScratchpadEntry from "../../customResolvers/mutations/deleteScratchpadEntry.js";
import sendBugReport from "../../customResolvers/mutations/sendBugReport.js";
import dropDataForCypressTests from "../../customResolvers/mutations/dropDataForCypressTests.js";
import seedDataForCypressTests from "../../customResolvers/mutations/seedDataForCypressTests.js";
import setRankingSettings from "../../customResolvers/mutations/setRankingSettings.js";
import createEmailAndUser from "../../customResolvers/mutations/createEmailAndUser.js";
import updateScratchpadEntryVisibility from "../../customResolvers/mutations/updateScratchpadEntryVisibility.js";
import { addToCollection, removeFromCollection, reorderCollectionItem } from "../../customResolvers/mutations/collectionOrdering.js";
import getAgePolicy from "../../customResolvers/queries/getAgePolicy.js";
import getInstanceSetupStatus from "../../customResolvers/queries/getInstanceSetupStatus.js";
import getOwnEmail from "../../customResolvers/queries/getOwnEmail.js";
import getRankingSettings from "../../customResolvers/queries/getRankingSettings.js";
import { createAccountRegistrationRepository } from "../../services/persistence/accountRegistrationRepository.js";
import { createInstancePolicyRepository } from "../../services/persistence/instancePolicyRepository.js";
import { createScratchpadRepository } from "../../services/persistence/scratchpadRepository.js";
declare const driver: Driver;
const policy = createInstancePolicyRepository(driver);
const accountRegistrationRepository = createAccountRegistrationRepository(driver);
const scratchpadRepository = createScratchpadRepository(driver);
const scalars = {
 acceptForumModInvite: acceptForumModInvite(),
 acceptForumOwnerInvite: acceptForumOwnerInvite(),
 acceptServerAdminInvite: acceptServerAdminInvite(),
 acceptServerModInvite: acceptServerModInvite(),
 cancelInviteForumMod: cancelInviteForumMod(),
 cancelInviteForumOwner: cancelInviteForumOwner(),
 cancelInviteServerAdmin: cancelInviteServerAdmin(),
 cancelInviteServerMod: cancelInviteServerMod(),
 inviteForumMod: inviteForumMod({driver}),
 inviteForumOwner: inviteForumOwner({driver}),
 inviteServerAdmin: inviteServerAdmin({driver}),
 inviteServerMod: inviteServerMod({driver}),
 removeForumMod: removeForumMod(),
 removeForumOwner: removeForumOwner(),
 becomeForumAdmin: becomeForumAdmin(),
 addToCollection: addToCollection({driver}), removeFromCollection: removeFromCollection({driver}), reorderCollectionItem: reorderCollectionItem({driver}),
 deleteScratchpadEntry: deleteScratchpadEntry({scratchpadRepository}), sendBugReport: sendBugReport(),
} satisfies AccountScalarMutationResolvers;
const collectionQueries = {publicCollectionsContaining: publicCollectionsContaining({driver})} satisfies AccountCollectionQueryResolvers;
const objects = {
 setProfileImage: setProfileImage({driver}), setChannelIcon: setChannelIcon({driver}),
 dropDataForCypressTests: dropDataForCypressTests({driver}), seedDataForCypressTests: seedDataForCypressTests({driver}),
 setRankingSettings: setRankingSettings({driver}), createEmailAndUser: createEmailAndUser({accountRegistrationRepository,agePolicyRepository:policy}),
 updateScratchpadEntryVisibility: updateScratchpadEntryVisibility({scratchpadRepository}),
} satisfies AccountObjectMutationResolvers;
const queries = {
 getAgePolicy: getAgePolicy({agePolicyRepository:policy}), getInstanceSetupStatus: getInstanceSetupStatus({instancePolicyRepository:policy}),
 getOwnEmail: getOwnEmail({accountRegistrationRepository}), getRankingSettings: getRankingSettings({driver}),
} satisfies AccountQueryResolvers;
// @ts-expect-error Boolean response cannot be an arbitrary string
const badScalar: AccountScalarMutationResolvers["cancelInviteForumMod"] = async () => "false";
// @ts-expect-error ranking response requires both configured ranking families
const incompleteRanking: AccountObjectMutationResolvers["setRankingSettings"] = () => ({ updatedBy: null });
// @ts-expect-error selected registration username cannot be numeric
const badUser: AccountObjectMutationResolvers["createEmailAndUser"] = () => ({ username: 5 });
// @ts-expect-error generated context cannot be replaced with unrelated required data
const badContext: AccountQueryResolvers["getOwnEmail"] = (_p: unknown, _a: unknown, context: GraphQLContext & { secret: string }) => null;
void [collectionQueries, scalars, objects, queries, badScalar, incompleteRanking, badUser, badContext];

import type { Driver } from "neo4j-driver";
import type { AccountWriteSourceMutationResolvers, AccountWriteSourceQueryResolvers } from "../../customResolvers/contracts/accountWriteSources.js";
import removeImage from "../../customResolvers/mutations/permanentlyRemoveImage.js";
import image from "../../customResolvers/mutations/permanentlyDeleteImage.js";
import profile from "../../customResolvers/mutations/permanentlyDeleteProfileImage.js";
import icon from "../../customResolvers/mutations/permanentlyDeleteChannelIcon.js";
import banner from "../../customResolvers/mutations/permanentlyDeleteChannelBanner.js";
import scratch from "../../customResolvers/mutations/createScratchpadEntry.js";
import setFlair from "../../customResolvers/mutations/setChannelDiscussionFlairConfig.js";
import getFlair from "../../customResolvers/queries/getChannelDiscussionFlairConfig.js";
import type { ScratchpadRepository } from "../../services/persistence/scratchpadRepository.js";
import type { ChannelDiscussionFlairConfig } from "../../services/discussionFlairStore.js";
declare const driver: Driver, scratchpadRepository: ScratchpadRepository;
const mutations={permanentlyRemoveImage:removeImage({driver}),permanentlyDeleteImage:image({driver}),permanentlyDeleteProfileImage:profile({driver}),permanentlyDeleteChannelIcon:icon({driver}),permanentlyDeleteChannelBanner:banner({driver}),createScratchpadEntry:scratch({driver,scratchpadRepository}),setChannelDiscussionFlairConfig:setFlair({driver})} satisfies AccountWriteSourceMutationResolvers;
const queries={getChannelDiscussionFlairConfig:getFlair({driver})} satisfies AccountWriteSourceQueryResolvers;
// @ts-expect-error selected identity cannot be numeric
const wrongIdentity: AccountWriteSourceMutationResolvers['permanentlyDeleteProfileImage']=()=>({username:1,profilePicURL:null});
declare const flair: ChannelDiscussionFlairConfig;
// @ts-expect-error persisted coalesce output remains unknown, not verified Boolean
const rawFlag: boolean=flair.flairRequired;
// @ts-expect-error raw flair id remains unknown
const rawId: string=flair.flairs[0].id;
void [mutations,queries,wrongIdentity,rawFlag,rawId];

// @ts-expect-error the close action proves a Boolean, not an arbitrary raw value
const wrongClosed: AccountWriteSourceMutationResolvers["permanentlyRemoveImage"]=()=>({id:"issue",isOpen:"false"});
void wrongClosed;

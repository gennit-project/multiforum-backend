import type {Driver} from 'neo4j-driver';
import type {IssueCreateInput, IssueUpdateInput, ChannelUpdateInput} from '../../src/generated/graphql.js';
import {attachIssueIdentityRelationships,assertIssueIdentityUpdateAllowed} from '../issueTargetIdentity.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {ISSUE_ACTIVITY_DEFAULT_SELECTION} from './issueActivityRepository.js';
export type ModeratedChannel = {uniqueName:string;displayName?:string|null;locked?:boolean|null;lockedAt?:string|null;lockReason?:string|null;LockedBy?:{displayName?:string|null}|null;Admins?:Array<{username:string}>};
type RelatedIssue={id:string;issueNumber:number;isOpen?:boolean|null};
export interface ChannelModerationRepository {
 findChannel(uniqueName:string):Promise<Array<ModeratedChannel & {Admins:Array<{username:string}>}>>;
 findOpenIssues(uniqueName:string):Promise<RelatedIssue[]>;
 findRelatedIssues(uniqueName:string):Promise<RelatedIssue[]>;
 createLockIssue(input:IssueCreateInput):Promise<{issues:RelatedIssue[]}>;
 recordAction(id:string,update:IssueUpdateInput):Promise<void>;
 updateLockState(uniqueName:string,update:ChannelUpdateInput):Promise<{channels:ModeratedChannel[]}>;
}
export function createChannelModerationRepository(driver:Driver):ChannelModerationRepository{return{
 async findChannel(uniqueName){const r=await executeGeneratedOperation<{channels:Array<ModeratedChannel & {Admins:Array<{username:string}>}>}>(driver,`query ChannelModerationSnapshot($where:ChannelWhere){channels(where:$where){uniqueName displayName locked Admins{username}}}`,{where:{uniqueName}});return r.channels;},
 async findOpenIssues(uniqueName){const r=await executeGeneratedOperation<{issues:RelatedIssue[]}>(driver,`query OpenChannelModerationIssues($where:IssueWhere){issues(where:$where){id issueNumber}}`,{where:{channelUniqueName:null,relatedChannelUniqueName:uniqueName,isOpen:true}});return r.issues;},
 async findRelatedIssues(uniqueName){const r=await executeGeneratedOperation<{issues:RelatedIssue[]}>(driver,`query RelatedChannelModerationIssues($where:IssueWhere){issues(where:$where){id issueNumber isOpen}}`,{where:{channelUniqueName:null,relatedChannelUniqueName:uniqueName}});return r.issues;},
 async createLockIssue(input){const r=await executeGeneratedOperation<{createIssues:{issues:RelatedIssue[]}}>(driver,`mutation CreateChannelLockIssue($input:[IssueCreateInput!]!){createIssues(input:$input){issues{id issueNumber}}}`,{input:[attachIssueIdentityRelationships(input)]});return r.createIssues;},
 async recordAction(id,update){assertIssueIdentityUpdateAllowed(update);await executeGeneratedOperation(driver,`mutation RecordChannelModerationAction($where:IssueWhere,$update:IssueUpdateInput){updateIssues(where:$where,update:$update){issues ${ISSUE_ACTIVITY_DEFAULT_SELECTION}}}`,{where:{id},update});},
 async updateLockState(uniqueName,update){const r=await executeGeneratedOperation<{updateChannels:{channels:ModeratedChannel[]}}>(driver,`mutation UpdateChannelLockState($where:ChannelWhere,$update:ChannelUpdateInput){updateChannels(where:$where,update:$update){channels{uniqueName displayName locked lockedAt lockReason LockedBy{displayName}}}}`,{where:{uniqueName},update});return r.updateChannels;},
};}

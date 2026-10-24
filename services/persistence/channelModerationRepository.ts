import type {Driver} from 'neo4j-driver';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';

export type ModeratedChannel = {uniqueName:string;displayName?:string|null;locked?:boolean|null;lockedAt?:string|null;lockReason?:string|null;LockedBy?:{displayName?:string|null}|null;Admins?:Array<{username:string}>};
type RelatedIssue={id:string;issueNumber:number;isOpen?:boolean|null};

// FAMILY-3 / v7 (campaign #284). The channel lock/unlock flow is relationship-
// heavy and security-relevant: it creates an Issue + ModerationAction + Comment,
// wires the AUTHORED_ISSUE / TARGETS_CHANNEL / ACTIVITY_ON_ISSUE / MODERATED_COMMENT
// / AUTHORED_COMMENT / PERFORMED_MODERATION_ACTION edges, and connects the acting
// moderator to the channel on a to-one relationship (LOCKED_CHANNEL). v7 removed
// nested connect/disconnect for to-one relationships, so those writes have no
// generated form. Per docs/write-layer-strategy.md the writes are owned here as
// parameterized Cypher run through the driver — atomic, leader-routed (driver
// default, preserving read-your-own-writes), verified by the integration suite
// rather than tsc. The reads stay on the generated API (v7 `{ eq: }` filters).
export interface ChannelModerationRepository {
 findChannel(uniqueName:string):Promise<Array<ModeratedChannel & {Admins:Array<{username:string}>}>>;
 findOpenIssues(uniqueName:string):Promise<RelatedIssue[]>;
 findRelatedIssues(uniqueName:string):Promise<RelatedIssue[]>;
 createLockIssue(params:{issueNumber:number;title:string;relatedChannelUniqueName:string;authorModName:string}):Promise<{id:string;issueNumber:number}>;
 recordAction(params:{issueId:string;actionType:string;actionDescription:string;commentText:string;modName:string;isOpen:boolean}):Promise<void>;
 updateLockState(params:{uniqueName:string;locked:boolean;lockReason:string|null;lockedAt:string|null;modName:string|null}):Promise<{channels:ModeratedChannel[]}>;
}

// Create the activity feed's ModerationAction + embedded moderator Comment and
// wire every edge in one statement. The issue must already exist (the resolver
// resolves/creates it first); a missing issue leaves the graph untouched, which
// is the intended behaviour when a caller supplies an issueId that is absent.
// The moderator edges are best-effort (OPTIONAL MATCH + FOREACH), mirroring the
// moderationActorConnect primitive.
const RECORD_ACTION = `
 MATCH (i:Issue {id:$issueId})
 CREATE (a:ModerationAction {id:randomUUID(),actionType:$actionType,actionDescription:$actionDescription,createdAt:datetime()})
 CREATE (i)-[:ACTIVITY_ON_ISSUE]->(a)
 CREATE (c:Comment {id:randomUUID(),text:$commentText,isRootComment:true,createdAt:datetime(),ageGateTouchedAt:datetime()})
 CREATE (a)-[:MODERATED_COMMENT]->(c)
 CREATE (c)-[:ACTIVITY_ON_ISSUE]->(i)
 SET i.isOpen=$isOpen, i.ageGateTouchedAt=datetime()
 WITH a,c
 OPTIONAL MATCH (mod:ModerationProfile {displayName:$modName})
 FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END |
  MERGE (mod)-[:PERFORMED_MODERATION_ACTION]->(a)
  MERGE (mod)-[:AUTHORED_COMMENT]->(c)
 )
`;

// Create a server-scoped (channelUniqueName null) issue for a channel lock,
// author it to the acting moderator (AUTHORED_ISSUE) and target the channel
// (TARGETS_CHANNEL). Issue + both edges in one statement; the connects are
// best-effort so a missing moderator/channel is skipped rather than failing.
const CREATE_LOCK_ISSUE = `
 CREATE (i:Issue {id:randomUUID(),issueNumber:toInteger($issueNumber),title:$title,isOpen:true,channelUniqueName:null,relatedChannelUniqueName:$relatedChannelUniqueName,authorName:$authorModName,flaggedServerRuleViolation:true,createdAt:datetime(),ageGateTouchedAt:datetime()})
 WITH i
 OPTIONAL MATCH (author:ModerationProfile {displayName:$authorModName})
 FOREACH (_ IN CASE WHEN author IS NULL THEN [] ELSE [1] END |
  MERGE (i)-[:AUTHORED_ISSUE]->(author)
 )
 WITH i
 OPTIONAL MATCH (ch:Channel {uniqueName:$relatedChannelUniqueName})
 FOREACH (_ IN CASE WHEN ch IS NULL THEN [] ELSE [1] END |
  MERGE (i)-[:TARGETS_CHANNEL]->(ch)
 )
 RETURN i.id AS id
`;

// Set the channel's lock scalars and (re)wire the single LOCKED_CHANNEL edge:
// clear any existing edge first (idempotent for re-lock, and the disconnect on
// unlock), then MERGE a fresh one only when locking and the moderator resolves.
const UPDATE_LOCK_STATE = `
 MATCH (ch:Channel {uniqueName:$uniqueName})
 SET ch.locked=$locked, ch.lockReason=$lockReason,
     ch.lockedAt = CASE WHEN $lockedAt IS NULL THEN null ELSE datetime($lockedAt) END
 WITH ch
 OPTIONAL MATCH (ch)<-[existing:LOCKED_CHANNEL]-()
 DELETE existing
 WITH ch
 OPTIONAL MATCH (mod:ModerationProfile {displayName:$modName})
 FOREACH (_ IN CASE WHEN $locked AND mod IS NOT NULL THEN [1] ELSE [] END |
  MERGE (mod)-[:LOCKED_CHANNEL]->(ch)
 )
 WITH ch
 OPTIONAL MATCH (ch)<-[:LOCKED_CHANNEL]-(locker:ModerationProfile)
 RETURN ch.uniqueName AS uniqueName, ch.displayName AS displayName, ch.locked AS locked,
        toString(ch.lockedAt) AS lockedAt, ch.lockReason AS lockReason, locker.displayName AS lockedByDisplayName
`;

export function createChannelModerationRepository(driver:Driver):ChannelModerationRepository{return{
 async findChannel(uniqueName){const r=await executeGeneratedOperation<{channels:Array<ModeratedChannel & {Admins:Array<{username:string}>}>}>(driver,`query ChannelModerationSnapshot($where:ChannelWhere){channels(where:$where){uniqueName displayName locked Admins{username}}}`,{where:{uniqueName:{eq:uniqueName}}});return r.channels;},
 async findOpenIssues(uniqueName){const r=await executeGeneratedOperation<{issues:RelatedIssue[]}>(driver,`query OpenChannelModerationIssues($where:IssueWhere){issues(where:$where){id issueNumber}}`,{where:{channelUniqueName:{eq:null},relatedChannelUniqueName:{eq:uniqueName},isOpen:{eq:true}}});return r.issues;},
 async findRelatedIssues(uniqueName){const r=await executeGeneratedOperation<{issues:RelatedIssue[]}>(driver,`query RelatedChannelModerationIssues($where:IssueWhere){issues(where:$where){id issueNumber isOpen}}`,{where:{channelUniqueName:{eq:null},relatedChannelUniqueName:{eq:uniqueName}}});return r.issues;},
 async createLockIssue(params){const r=await driver.executeQuery(CREATE_LOCK_ISSUE,params);const row=r.records[0];if(!row)throw new Error('Error creating issue for channel lock');return{id:row.get('id') as string,issueNumber:params.issueNumber};},
 async recordAction(params){await driver.executeQuery(RECORD_ACTION,params);},
 async updateLockState(params){const r=await driver.executeQuery(UPDATE_LOCK_STATE,{uniqueName:params.uniqueName,locked:params.locked,lockReason:params.lockReason,lockedAt:params.lockedAt,modName:params.modName});const channels=r.records.map(row=>{const lockedBy=row.get('lockedByDisplayName');return{uniqueName:row.get('uniqueName') as string,displayName:row.get('displayName') as string|null,locked:row.get('locked') as boolean|null,lockedAt:row.get('lockedAt') as string|null,lockReason:row.get('lockReason') as string|null,LockedBy:lockedBy?{displayName:lockedBy as string}:null};});return{channels};},
};}

import type { Driver } from "neo4j-driver";
import {
  appendModerationActions,
  type AppendModerationActionsParams,
} from "./moderationIssueWrites.js";

type IssueResult = { issues: Array<{id: string; issueNumber?: number | null; ActivityFeed: Array<{id: string; actionType?: string | null}>}> };

// FAMILY-3 / v7 (campaign #284). The suspension flow is owned Cypher: the Issue
// ModerationActions go through moderationIssueWrites; the Suspension node and its
// to-one edges (SuspendedUser/SuspendedMod, RelatedIssue — v7 removed their nested
// connect) are written here. Leader-routed via the driver default.
export type SuspensionSubjectType = "User" | "ModerationProfile";
export type AddSuspensionParams = {
  scope: "server" | "channel";
  ownerServerName?: string | null;
  ownerChannelUniqueName?: string | null;
  subjectType: SuspensionSubjectType;
  subjectKey: string; // username (User) or displayName (ModerationProfile) to connect
  issueId: string;
  // Suspension scalars:
  channelUniqueName?: string | null;
  serverName?: string | null;
  username?: string | null;
  modProfileName?: string | null;
  suspendedUntil?: string | null;
  suspendedIndefinitely?: boolean | null;
};
export type RemoveSuspensionParams = {
  scope: "server" | "channel";
  ownerServerName?: string | null;
  ownerChannelUniqueName?: string | null;
  subjectType: SuspensionSubjectType;
  subjectKey: string;
};

export interface SuspensionWriteRepository {
  appendSuspensionActivity(params: AppendModerationActionsParams): Promise<void>;
  closeSuspensionIssue(params: AppendModerationActionsParams): Promise<IssueResult>;
  addSuspension(params: AddSuspensionParams): Promise<{ ownerKey: string | null }>;
  removeSuspension(params: RemoveSuspensionParams): Promise<void>;
}

// SUSPENDED_AS_USER / SUSPENDED_AS_MOD are the relationship types from typeDefs;
// subject key is username (User) vs displayName (ModerationProfile).
const relFor = (t: SuspensionSubjectType) => (t === "User" ? "SUSPENDED_AS_USER" : "SUSPENDED_AS_MOD");
const subjectLabelFor = (t: SuspensionSubjectType) => (t === "User" ? "User" : "ModerationProfile");
const subjectKeyFor = (t: SuspensionSubjectType) => (t === "User" ? "username" : "displayName");

export function createSuspensionWriteRepository(driver: Driver): SuspensionWriteRepository {
  return {
    async appendSuspensionActivity(params) {
      await appendModerationActions(driver, params);
    },
    async closeSuspensionIssue(params) {
      const result = await appendModerationActions(driver, params);
      return { issues: result.issues as unknown as IssueResult["issues"] };
    },
    async addSuspension(params) {
      const rel = relFor(params.subjectType);
      const ownerClause =
        params.scope === "server"
          ? "MATCH (owner:ServerConfig {serverName: $ownerServerName})"
          : "MATCH (owner:Channel {uniqueName: $ownerChannelUniqueName})";
      const subjectClause = `OPTIONAL MATCH (subject:${subjectLabelFor(params.subjectType)} {${subjectKeyFor(params.subjectType)}: $subjectKey})`;
      const ownerKeyReturn = params.scope === "server" ? "owner.serverName" : "owner.uniqueName";
      const cypher = `
 ${ownerClause}
 CREATE (s:Suspension {
   id: randomUUID(),
   channelUniqueName: $channelUniqueName,
   serverName: $serverName,
   username: $username,
   modProfileName: $modProfileName,
   suspendedUntil: CASE WHEN $suspendedUntil IS NULL THEN null ELSE datetime($suspendedUntil) END,
   suspendedIndefinitely: $suspendedIndefinitely,
   createdAt: datetime()
 })
 CREATE (owner)-[:${rel}]->(s)
 WITH s, owner
 ${subjectClause}
 FOREACH (_ IN CASE WHEN subject IS NULL THEN [] ELSE [1] END |
  MERGE (subject)-[:${rel}]->(s)
 )
 WITH s, owner
 OPTIONAL MATCH (i:Issue {id: $issueId})
 FOREACH (_ IN CASE WHEN i IS NULL THEN [] ELSE [1] END |
  MERGE (s)-[:HAS_CONTEXT]->(i)
 )
 RETURN ${ownerKeyReturn} AS ownerKey
`;
      const result = await driver.executeQuery(cypher, {
        ownerServerName: params.ownerServerName ?? null,
        ownerChannelUniqueName: params.ownerChannelUniqueName ?? null,
        subjectKey: params.subjectKey,
        issueId: params.issueId,
        channelUniqueName: params.channelUniqueName ?? null,
        serverName: params.serverName ?? null,
        username: params.username ?? null,
        modProfileName: params.modProfileName ?? null,
        suspendedUntil: params.suspendedUntil ?? null,
        suspendedIndefinitely: params.suspendedIndefinitely ?? null,
      });
      const ownerKey = result.records[0]?.get("ownerKey");
      return { ownerKey: (ownerKey as string | null) ?? null };
    },
    async removeSuspension(params) {
      const rel = relFor(params.subjectType);
      const ownerClause =
        params.scope === "server"
          ? "MATCH (owner:ServerConfig {serverName: $ownerServerName})"
          : "MATCH (owner:Channel {uniqueName: $ownerChannelUniqueName})";
      // Delete the owner -> Suspension edge for suspensions whose subject matches
      // (mirrors the former disconnect by SuspendedUser.username / SuspendedMod.displayName).
      const cypher = `
 ${ownerClause}
 MATCH (owner)-[r:${rel}]->(s:Suspension)<-[:${rel}]-(subject:${subjectLabelFor(params.subjectType)} {${subjectKeyFor(params.subjectType)}: $subjectKey})
 DELETE r
`;
      await driver.executeQuery(cypher, {
        ownerServerName: params.ownerServerName ?? null,
        ownerChannelUniqueName: params.ownerChannelUniqueName ?? null,
        subjectKey: params.subjectKey,
      });
    },
  };
}

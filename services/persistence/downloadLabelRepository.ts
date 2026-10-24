import type { Driver } from "neo4j-driver";
import type { Discussion, DiscussionChannel, FilterOption, DiscussionChannelUpdateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
export const FINDDISCUSSION_SELECTION = `{
        id
        title
        Author {
          username
        }
      }`;
export const FINDCHANNEL_SELECTION = `{
        id
        LabelOptions {
          id
          value
          displayName
        }
      }`;
export const FINDOPTIONS_SELECTION = `{
          id
          displayName
          value
          group {
            id
            key
            displayName
            uploadSelection
          }
        }`;
export const UPDATELABELS_SELECTION = `{
        discussionChannels {
          id
          LabelOptions {
            id
            value
            displayName
            order
            group {
              id
              key
              displayName
            }
          }
        }
      }`;
export const CREATEHISTORY_SELECTION = `{ labelChangeHistories {
  id
  actionType
  labelDisplayName
  labelValue
  createdAt
} }`;
export const CREATEMODERATIONACTION_SELECTION = `{ moderationActions {
  id
  actionType
  actionDescription
  createdAt
} }`;
export interface DownloadLabelRepository {
 findDiscussion(id: string): Promise<Discussion[]>;
 findChannel(discussionId: string, channelUniqueName: string): Promise<DiscussionChannel[]>;
 findOptions(ids: string[]): Promise<FilterOption[]>;
 updateLabels(id: string, update: DiscussionChannelUpdateInput): Promise<{discussionChannels: DiscussionChannel[]}>;
 createHistory(input: Array<Record<string, unknown>>): Promise<void>;
 createModerationAction(input: Array<Record<string, unknown>>): Promise<void>;
}
export function createDownloadLabelRepository(driver: Driver): DownloadLabelRepository {
 return {
    async findDiscussion(id) {
      const result = await executeGeneratedOperation<{discussions:Discussion[]}>(driver,
        `query DownloadLabels_findDiscussion($where: DiscussionWhere) { discussions(where: $where) ${FINDDISCUSSION_SELECTION} }`, {where:{id:{eq:id}}});
      return result.discussions;
    },
    async findChannel(discussionId, channelUniqueName) {
      const result = await executeGeneratedOperation<{discussionChannels:DiscussionChannel[]}>(driver,
        `query DownloadLabels_findChannel($where: DiscussionChannelWhere) { discussionChannels(where: $where) ${FINDCHANNEL_SELECTION} }`, {where:{discussionId:{eq:discussionId}, channelUniqueName:{eq:channelUniqueName}}});
      return result.discussionChannels;
    },
    async findOptions(ids) {
      const result = await executeGeneratedOperation<{filterOptions:FilterOption[]}>(driver,
        `query DownloadLabels_findOptions($where: FilterOptionWhere) { filterOptions(where: $where) ${FINDOPTIONS_SELECTION} }`, {where:{id:{in:ids}}});
      return result.filterOptions;
    },
    async updateLabels(id, update) {
      const result = await executeGeneratedOperation<{updateDiscussionChannels:{discussionChannels:DiscussionChannel[]}}>(driver,
        `mutation DownloadLabels_updateLabels($where: DiscussionChannelWhere, $update: DiscussionChannelUpdateInput) { updateDiscussionChannels(where: $where, update: $update) ${UPDATELABELS_SELECTION} }`, {where:{id:{eq:id}}, update});
      return result.updateDiscussionChannels;
    },
    async createHistory(input) {
      // FAMILY-3 / v7: DiscussionChannel (HAS_LABEL_CHANGE) and the actor
      // (MADE_LABEL_CHANGE, User or ModerationProfile) are to-one connects v7
      // removed, so this is an owned write.
      const h = (input[0] ?? {}) as Record<string, any>;
      await driver.executeQuery(
        `CREATE (h:LabelChangeHistory {id: randomUUID(), actionType: $actionType, labelDisplayName: $labelDisplayName, labelValue: $labelValue, createdAt: datetime()})
         WITH h
         OPTIONAL MATCH (dc:DiscussionChannel {id: $discussionChannelId})
         FOREACH (_ IN CASE WHEN dc IS NULL THEN [] ELSE [1] END | MERGE (dc)-[:HAS_LABEL_CHANGE]->(h))
         WITH h
         OPTIONAL MATCH (u:User {username: $actorUsername})
         FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | MERGE (u)-[:MADE_LABEL_CHANGE]->(h))
         WITH h
         OPTIONAL MATCH (mod:ModerationProfile {displayName: $actorModName})
         FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END | MERGE (mod)-[:MADE_LABEL_CHANGE]->(h))`,
        {
          actionType: h.actionType ?? null,
          labelDisplayName: h.labelDisplayName ?? null,
          labelValue: h.labelValue ?? null,
          discussionChannelId: h.DiscussionChannel?.connect?.where?.node?.id ?? null,
          actorUsername: h.ActorUser?.connect?.where?.node?.username ?? null,
          actorModName: h.ActorMod?.connect?.where?.node?.displayName ?? null,
        }
      );
    },
    async createModerationAction(input) {
      // FAMILY-3 / v7: the ModerationProfile actor is a to-one connect v7 removed,
      // so this standalone action is an owned write (PERFORMED_MODERATION_ACTION).
      const action = (input[0] ?? {}) as Record<string, any>;
      await driver.executeQuery(
        `CREATE (a:ModerationAction {id: randomUUID(), actionType: $actionType, actionDescription: $actionDescription, createdAt: datetime()})
         WITH a
         OPTIONAL MATCH (mod:ModerationProfile {displayName: $modProfileName})
         FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END | MERGE (mod)-[:PERFORMED_MODERATION_ACTION]->(a))`,
        {
          actionType: action.actionType ?? null,
          actionDescription: action.actionDescription ?? null,
          modProfileName: action.ModerationProfile?.connect?.where?.node?.displayName ?? null,
        }
      );
    },
  };
}

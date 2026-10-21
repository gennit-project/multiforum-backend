import type { Driver } from "neo4j-driver";
import type { Discussion, DiscussionChannel, FilterOption, DiscussionChannelUpdateInput, LabelChangeHistoryCreateInput, ModerationActionCreateInput } from "../../ogm_types.js";
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
 createHistory(input: LabelChangeHistoryCreateInput[]): Promise<void>;
 createModerationAction(input: ModerationActionCreateInput[]): Promise<void>;
}
export function createDownloadLabelRepository(driver: Driver): DownloadLabelRepository {
 return {
    async findDiscussion(id) {
      const result = await executeGeneratedOperation<{discussions:Discussion[]}>(driver,
        `query DownloadLabels_findDiscussion($where: DiscussionWhere) { discussions(where: $where) ${FINDDISCUSSION_SELECTION} }`, {where:{id}});
      return result.discussions;
    },
    async findChannel(discussionId, channelUniqueName) {
      const result = await executeGeneratedOperation<{discussionChannels:DiscussionChannel[]}>(driver,
        `query DownloadLabels_findChannel($where: DiscussionChannelWhere) { discussionChannels(where: $where) ${FINDCHANNEL_SELECTION} }`, {where:{discussionId, channelUniqueName}});
      return result.discussionChannels;
    },
    async findOptions(ids) {
      const result = await executeGeneratedOperation<{filterOptions:FilterOption[]}>(driver,
        `query DownloadLabels_findOptions($where: FilterOptionWhere) { filterOptions(where: $where) ${FINDOPTIONS_SELECTION} }`, {where:{id_IN:ids}});
      return result.filterOptions;
    },
    async updateLabels(id, update) {
      const result = await executeGeneratedOperation<{updateDiscussionChannels:{discussionChannels:DiscussionChannel[]}}>(driver,
        `mutation DownloadLabels_updateLabels($where: DiscussionChannelWhere, $update: DiscussionChannelUpdateInput) { updateDiscussionChannels(where: $where, update: $update) ${UPDATELABELS_SELECTION} }`, {where:{id}, update});
      return result.updateDiscussionChannels;
    },
    async createHistory(input) {
      await executeGeneratedOperation(driver,
        `mutation DownloadLabels_createHistory($input: [LabelChangeHistoryCreateInput!]!) { createLabelChangeHistories(input: $input) ${CREATEHISTORY_SELECTION} }`, {input});
    },
    async createModerationAction(input) {
      await executeGeneratedOperation(driver,
        `mutation DownloadLabels_createModerationAction($input: [ModerationActionCreateInput!]!) { createModerationActions(input: $input) ${CREATEMODERATIONACTION_SELECTION} }`, {input});
    },
  };
}

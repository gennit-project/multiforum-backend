import type { Driver } from "neo4j-driver";
import type { Scalars } from "../../src/generated/graphql.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

// Exact selections from the two emoji validation queries below. JSON retains
// the schema scalar's unrestricted output type; this does not validate its shape.
export type EmojiChannelPreference = { uniqueName: string; emojiEnabled: boolean | null };
export type EmojiDiscussionContext = {
  channelUniqueName: string;
  locked: boolean | null;
  archived: boolean | null;
  Channel: EmojiChannelPreference | null;
};
export type DiscussionChannelEmojiState = EmojiDiscussionContext & {
  id: string;
  emoji: Scalars["JSON"]["output"];
};
export type CommentEmojiState = {
  id: string;
  emoji: Scalars["JSON"]["output"];
  archived: boolean | null;
  Channel: EmojiChannelPreference | null;
  DiscussionChannel: EmojiDiscussionContext | null;
};

type DiscussionChannels = { DiscussionChannels?: Array<{channelUniqueName?: string | null}> | null };
export interface ContentValidationRepository {
  findDiscussionChannels(where: unknown): Promise<DiscussionChannels[]>;
  findExistingDownloadableFiles(where: unknown): Promise<Array<{id: string; fileName: string}>>;
  findDiscussionChannelEmojiState(id: string): Promise<DiscussionChannelEmojiState[]>;
  findCommentEmojiState(id: string): Promise<CommentEmojiState[]>;
}

const DISCUSSION_CHANNELS = `query ValidationDiscussionChannels($where: DiscussionWhere) {
 discussions(where: $where) { DiscussionChannels { channelUniqueName } }
}`;
const EXISTING_FILES = `query ValidationExistingDownloadableFiles($where: DownloadableFileWhere) {
 downloadableFiles(where: $where) { id fileName }
}`;
const DISCUSSION_EMOJI = `query ValidationDiscussionEmoji($where: DiscussionChannelWhere) { discussionChannels(where: $where) {
      id
      emoji
      locked
      archived
      channelUniqueName
      Channel {
        uniqueName
        emojiEnabled
      }
    } }`;
const COMMENT_EMOJI = `query ValidationCommentEmoji($where: CommentWhere) { comments(where: $where) {
      id
      emoji
      archived
      Channel {
        uniqueName
        emojiEnabled
      }
      DiscussionChannel {
        channelUniqueName
        locked
        archived
        Channel {
          uniqueName
          emojiEnabled
        }
      }
    } }`;

export function createContentValidationRepository(driver: Driver): ContentValidationRepository {
 return {
  async findDiscussionChannels(where) {
   return (await executeGeneratedOperation<{discussions: DiscussionChannels[]}>(driver,DISCUSSION_CHANNELS,{where})).discussions;
  },
  async findExistingDownloadableFiles(where) {
   return (await executeGeneratedOperation<{downloadableFiles: Array<{id:string;fileName:string}>}>(driver,EXISTING_FILES,{where})).downloadableFiles;
  },
  async findDiscussionChannelEmojiState(id) {
   return (await executeGeneratedOperation<{discussionChannels: DiscussionChannelEmojiState[]}>(driver,DISCUSSION_EMOJI,{where:{id:{eq:id}}})).discussionChannels;
  },
  async findCommentEmojiState(id) {
   return (await executeGeneratedOperation<{comments: CommentEmojiState[]}>(driver,COMMENT_EMOJI,{where:{id:{eq:id}}})).comments;
  },
 };
}
export function resolveContentValidationRepository(context: {driver?: Driver; contentValidationRepository?: ContentValidationRepository}): ContentValidationRepository {
 if (context.contentValidationRepository) return context.contentValidationRepository;
 if (!context.driver) throw new Error("Driver is required for content validation");
 return createContentValidationRepository(context.driver);
}

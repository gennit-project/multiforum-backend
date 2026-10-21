import type { Driver } from "neo4j-driver";
import type { Comment, DiscussionChannel } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

type DiscussionChannels = { DiscussionChannels?: Array<{channelUniqueName?: string | null}> | null };
export interface ContentValidationRepository {
  findDiscussionChannels(where: unknown): Promise<DiscussionChannels[]>;
  findExistingDownloadableFiles(where: unknown): Promise<Array<{id: string; fileName: string}>>;
  findDiscussionChannelEmojiState(id: string): Promise<DiscussionChannel[]>;
  findCommentEmojiState(id: string): Promise<Comment[]>;
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
   return (await executeGeneratedOperation<{discussionChannels: DiscussionChannel[]}>(driver,DISCUSSION_EMOJI,{where:{id}})).discussionChannels;
  },
  async findCommentEmojiState(id) {
   return (await executeGeneratedOperation<{comments: Comment[]}>(driver,COMMENT_EMOJI,{where:{id}})).comments;
  },
 };
}
export function resolveContentValidationRepository(context: {driver?: Driver; contentValidationRepository?: ContentValidationRepository}): ContentValidationRepository {
 if (context.contentValidationRepository) return context.contentValidationRepository;
 if (!context.driver) throw new Error("Driver is required for content validation");
 return createContentValidationRepository(context.driver);
}

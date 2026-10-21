import type {Driver} from 'neo4j-driver';
import type {Comment,CommentCreateInput} from '../../ogm_types.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
export interface BotCommentRepository {createReply(input:CommentCreateInput):Promise<{comments:Comment[]}>;}
export const BOT_COMMENT_SELECTION=`{id text editReason isRootComment isFeedbackComment deleted archived isSticky stickyByUsername weightedVotesCount botMentions isFavoritedByUser emoji stickyAt updatedAt textLastEdited createdAt}`;
const CREATE=`mutation CreateBotComment($input:[CommentCreateInput!]!){createComments(input:$input){comments ${BOT_COMMENT_SELECTION}}}`;
export const createBotCommentRepository=(driver:Driver):BotCommentRepository=>({async createReply(input){return(await executeGeneratedOperation<{createComments:{comments:Comment[]}}>(driver,CREATE,{input:[input]})).createComments;}});

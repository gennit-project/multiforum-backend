import type {BotExistingReport,BotReportedComment,BotReportedDiscussion} from '../../customResolvers/contracts/botReportProjections.js';
import type {BotReportRepository} from '../../services/persistence/botReportRepository.js';
declare const comment:BotReportedComment;
if(comment.CommentAuthor?.__typename==='User'){
 const username:string=comment.CommentAuthor.username;
 // @ts-expect-error user branch did not select a moderator name
 void comment.CommentAuthor.displayName;
 void username;
}
if(comment.CommentAuthor?.__typename==='ModerationProfile'){
 const displayName:string|null|undefined=comment.CommentAuthor.displayName;
 // @ts-expect-error moderator branch has no user identity
 void comment.CommentAuthor.username;
 void displayName;
}
// @ts-expect-error selected nullable fields must be present
const incomplete:BotExistingReport={id:'issue',issueNumber:1};
declare const discussion:BotReportedDiscussion;
// @ts-expect-error Author remains nullable
const username:string=discussion.Author.username;
declare const result:Awaited<ReturnType<BotReportRepository['createReportedIssue']>>;
// @ts-expect-error raw owned write does not certify persisted numbering
const number:number=result.issues[0].issueNumber;
// @ts-expect-error raw owned write does not fetch author relationships
const author:{username:string}=result.issues[0].Author;
void [incomplete,username,number,author];

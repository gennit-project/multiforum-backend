import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { ISSUE_ACTIVITY_DEFAULT_SELECTION } from "./issueActivityRepository.js";
type Author = {username?: string | null; displayName?: string | null};
export interface IssueActivityMiddlewareRepository {
  findCommentAuthor(id: string): Promise<Array<{id?: string; CommentAuthor?: Author | null}>>;
  findDiscussionAuthor(id: string): Promise<Array<{id?: string; Author?: Author | null}>>;
  findEventAuthor(id: string): Promise<Array<{id?: string; Poster?: Author | null}>>;
  findDeleteActivities(id: string): Promise<Array<{id: string}>>;
  closeDeletedIssue(id: string): Promise<void>;
}
const COMMENT = `query ActivityCommentAuthor($where: CommentWhere) { comments(where:$where) { id CommentAuthor { ... on User { username displayName } ... on ModerationProfile { displayName } } } }`;
const DISCUSSION = `query ActivityDiscussionAuthor($where: DiscussionWhere) { discussions(where:$where) { id Author { username displayName } } }`;
const EVENT = `query ActivityEventAuthor($where: EventWhere) { events(where:$where) { id Poster { username displayName } } }`;
const DELETES = `query IssueDeleteActivities($where: IssueWhere) { issues(where:$where) { id } }`;
const CLOSE = `mutation CloseDeletedIssue($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where:$where, update:$update) { issues ${ISSUE_ACTIVITY_DEFAULT_SELECTION} } }`;
export function createIssueActivityMiddlewareRepository(driver: Driver): IssueActivityMiddlewareRepository {
 return {
  async findCommentAuthor(id) { return (await executeGeneratedOperation<{comments:Awaited<ReturnType<IssueActivityMiddlewareRepository['findCommentAuthor']>>}>(driver,COMMENT,{where:{id:{eq:id}}})).comments; },
  async findDiscussionAuthor(id) { return (await executeGeneratedOperation<{discussions:Awaited<ReturnType<IssueActivityMiddlewareRepository['findDiscussionAuthor']>>}>(driver,DISCUSSION,{where:{id:{eq:id}}})).discussions; },
  async findEventAuthor(id) { return (await executeGeneratedOperation<{events:Awaited<ReturnType<IssueActivityMiddlewareRepository['findEventAuthor']>>}>(driver,EVENT,{where:{id:{eq:id}}})).events; },
  async findDeleteActivities(id) { return (await executeGeneratedOperation<{issues:Array<{id:string}>}>(driver,DELETES,{where:{id:{eq:id},ActivityFeed:{some:{actionType:{eq:'delete'}}}}})).issues; },
  async closeDeletedIssue(id) { await executeGeneratedOperation(driver,CLOSE,{where:{id:{eq:id}},update:{isOpen:{set:false}}}); },
 };
}

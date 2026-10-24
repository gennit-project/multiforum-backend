import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type IssueTargetUser = { username?: string | null; isBot?: boolean | null };
export type IssueTargetMod = { displayName?: string | null };
export type IssueTargetSnapshot = {
    id?: string | null
    channelUniqueName?: string | null
    relatedDiscussionId?: string | null
    relatedEventId?: string | null
    relatedCommentId?: string | null
    relatedWikiPageId?: string | null
    relatedWikiRevisionId?: string | null
    relatedUsername?: string | null
    relatedModProfileName?: string | null
    Channel?: { uniqueName?: string | null } | null
    TargetDiscussion?: { id?: string | null } | null
    TargetEvent?: { id?: string | null } | null
    TargetComment?: { id?: string | null } | null
    TargetWikiPage?: { id?: string | null } | null
    TargetWikiRevision?: { id?: string | null } | null
    TargetUser?: { username?: string | null; isBot?: boolean | null } | null
    TargetModProfile?: { displayName?: string | null } | null
  };

export interface IssueTargetRepository {
  findProfileOwner(displayName: string): Promise<Array<IssueTargetUser>>;
  findIssue(issueId: string): Promise<Array<IssueTargetSnapshot>>;
  findDirectUser(username: string): Promise<Array<IssueTargetUser>>;
  findDiscussionAuthor(id: string): Promise<Array<{ id?: string; Author?: IssueTargetUser | null }>>;
  findEventPoster(id: string): Promise<Array<{ id?: string; Poster?: IssueTargetUser | null }>>;
  findCommentAuthor(id: string): Promise<Array<{ id?: string; CommentAuthor?: IssueTargetUser | IssueTargetMod | null }>>;
  findRevisionAuthor(id: string): Promise<Array<{ id?: string; Author?: IssueTargetUser | null }>>;
  findWikiAuthors(id: string): Promise<Array<{ id?: string; OriginalAuthor?: IssueTargetUser | null; VersionAuthor?: IssueTargetUser | null }>>;
}

// Fixed projections retain anonymous internal filtering, unions and scalar errors.
const FINDPROFILEOWNER = `query IssueTargetFindProfileOwner($where: UserWhere) {
  users(where: $where) { username }
}`;
const FINDISSUE = `query IssueTargetFindIssue($where: IssueWhere) {
  issues(where: $where) {
      id
      channelUniqueName
      relatedDiscussionId
      relatedEventId
      relatedCommentId
      relatedWikiPageId
      relatedWikiRevisionId
      relatedUsername
      relatedModProfileName
      Channel { uniqueName }
      TargetDiscussion { id }
      TargetEvent { id }
      TargetComment { id }
      TargetWikiPage { id }
      TargetWikiRevision { id }
      TargetUser { username isBot }
      TargetModProfile { displayName }
    }
}`;
const FINDDIRECTUSER = `query IssueTargetFindDirectUser($where: UserWhere) {
  users(where: $where) { username isBot }
}`;
const FINDDISCUSSIONAUTHOR = `query IssueTargetFindDiscussionAuthor($where: DiscussionWhere) {
  discussions(where: $where) { id Author { username isBot } }
}`;
const FINDEVENTPOSTER = `query IssueTargetFindEventPoster($where: EventWhere) {
  events(where: $where) { id Poster { username isBot } }
}`;
const FINDCOMMENTAUTHOR = `query IssueTargetFindCommentAuthor($where: CommentWhere) {
  comments(where: $where) {
        id
        CommentAuthor {
          ... on User { username isBot }
          ... on ModerationProfile { displayName }
        }
      }
}`;
const FINDREVISIONAUTHOR = `query IssueTargetFindRevisionAuthor($where: TextVersionWhere) {
  textVersions(where: $where) { id Author { username isBot } }
}`;
const FINDWIKIAUTHORS = `query IssueTargetFindWikiAuthors($where: WikiPageWhere) {
  wikiPages(where: $where) {
        id
        OriginalAuthor { username isBot }
        VersionAuthor { username isBot }
      }
}`;

export function createIssueTargetRepository(driver: Driver): IssueTargetRepository {
  return {
    async findProfileOwner(displayName) {
      const result = await executeGeneratedOperation<{ users: Array<IssueTargetUser> }>(driver, FINDPROFILEOWNER, { where: { ModerationProfile: { displayName: { eq: displayName } } } });
      return result.users;
    },
    async findIssue(issueId) {
      const result = await executeGeneratedOperation<{ issues: Array<IssueTargetSnapshot> }>(driver, FINDISSUE, { where: { id: { eq: issueId } } });
      return result.issues;
    },
    async findDirectUser(username) {
      const result = await executeGeneratedOperation<{ users: Array<IssueTargetUser> }>(driver, FINDDIRECTUSER, { where: { username: { eq: username } } });
      return result.users;
    },
    async findDiscussionAuthor(id) {
      const result = await executeGeneratedOperation<{ discussions: Array<{ id?: string; Author?: IssueTargetUser | null }> }>(driver, FINDDISCUSSIONAUTHOR, { where: { id: { eq: id } } });
      return result.discussions;
    },
    async findEventPoster(id) {
      const result = await executeGeneratedOperation<{ events: Array<{ id?: string; Poster?: IssueTargetUser | null }> }>(driver, FINDEVENTPOSTER, { where: { id: { eq: id } } });
      return result.events;
    },
    async findCommentAuthor(id) {
      const result = await executeGeneratedOperation<{ comments: Array<{ id?: string; CommentAuthor?: IssueTargetUser | IssueTargetMod | null }> }>(driver, FINDCOMMENTAUTHOR, { where: { id: { eq: id } } });
      return result.comments;
    },
    async findRevisionAuthor(id) {
      const result = await executeGeneratedOperation<{ textVersions: Array<{ id?: string; Author?: IssueTargetUser | null }> }>(driver, FINDREVISIONAUTHOR, { where: { id: { eq: id } } });
      return result.textVersions;
    },
    async findWikiAuthors(id) {
      const result = await executeGeneratedOperation<{ wikiPages: Array<{ id?: string; OriginalAuthor?: IssueTargetUser | null; VersionAuthor?: IssueTargetUser | null }> }>(driver, FINDWIKIAUTHORS, { where: { id: { eq: id } } });
      return result.wikiPages;
    },
  };
}

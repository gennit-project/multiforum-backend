// Shared, pure channel-resolution logic for channel-scoped moderation rules.
//
// Most `can*` mod rules (report, archive comment/discussion/event, suspend)
// need a channel to check permissions against. The channel may be passed
// directly, or derived from an associated issue or comment. This module holds
// the decision logic — given the (already-fetched) issue/comment records, work
// out the channel or the appropriate error. The async fetching stays in each
// rule; this stays pure so it can be exhaustively unit-tested in one place.

export const NO_CHANNEL_ERROR = "No channel specified for this operation.";
export const ISSUE_NOT_FOUND_ERROR =
  "Could not find the issue or its associated channel.";
export const COMMENT_NOT_FOUND_ERROR =
  "Could not find the comment or its associated channel.";

export type IssueChannelLookup = {
  found: boolean;
  channelUniqueName: string | null;
};

export type CommentChannelLookup = {
  found: boolean;
  directChannelUniqueName: string | null;
};

export type ChannelResolution =
  | { channelUniqueName: string; error?: undefined }
  | { channelUniqueName?: undefined; error: Error };

export interface ResolveChannelInput {
  // Channel passed directly on the operation's args, if any.
  channelUniqueName?: string | null;
  // Ids that, when present and no direct channel was given, trigger a lookup.
  issueId?: string;
  commentId?: string;
  // Normalized repository results fetched by the caller for those ids.
  issue?: IssueChannelLookup;
  comment?: CommentChannelLookup;
}

export function resolveChannelForModPermission(
  input: ResolveChannelInput
): ChannelResolution {
  let channelUniqueName: string | null | undefined = input.channelUniqueName;

  if (!channelUniqueName) {
    if (input.issueId) {
      const issue = input.issue;
      if (!issue?.found) {
        return { error: new Error(ISSUE_NOT_FOUND_ERROR) };
      }
      channelUniqueName = issue.channelUniqueName;
    }
    if (input.commentId) {
      const comment = input.comment;
      if (!comment?.found) {
        return { error: new Error(COMMENT_NOT_FOUND_ERROR) };
      }
      channelUniqueName = comment.directChannelUniqueName;
    }
  }

  if (!channelUniqueName) {
    return { error: new Error(NO_CHANNEL_ERROR) };
  }

  return { channelUniqueName };
}

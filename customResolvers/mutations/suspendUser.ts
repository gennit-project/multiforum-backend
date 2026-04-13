import type { IssueModel, ChannelModel, EventModel, DiscussionModel, CommentModel, ServerConfigModel, TextVersionModel, WikiPageModel, UserModel } from "../../ogm_types.js";
import { createSuspensionResolver } from "./shared/createSuspensionResolver.js";

type Input = {
  Issue: IssueModel;
  Channel: ChannelModel;
  ServerConfig: ServerConfigModel;
  Event: EventModel;
  Comment: CommentModel;
  Discussion: DiscussionModel;
  User: UserModel;
  WikiPage?: WikiPageModel;
  TextVersion?: TextVersionModel;
};

export default function getResolver(input: Input) {
  const { Issue, Channel, ServerConfig, Event, Comment, Discussion, User, WikiPage, TextVersion } = input;
  return createSuspensionResolver({
    Issue,
    Channel,
    ServerConfig,
    Event,
    Comment,
    Discussion,
    User,
    WikiPage,
    TextVersion,
    issueRelatedAccountField: "relatedUsername",
    channelSuspendedField: "SuspendedUsers",
    suspendedEntityName: "user",
    suspensionCommentText: "The user has been suspended.",
  });
}

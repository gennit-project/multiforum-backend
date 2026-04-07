import type { IssueModel, ChannelModel, EventModel, DiscussionModel, CommentModel, ServerConfigModel } from "../../ogm_types.js";
import { createSuspensionResolver } from "./shared/createSuspensionResolver.js";

type Input = {
  Issue: IssueModel;
  Channel: ChannelModel;
  ServerConfig: ServerConfigModel;
  Event: EventModel;
  Comment: CommentModel;
  Discussion: DiscussionModel;
};

export default function getResolver(input: Input) {
  const { Issue, Channel, ServerConfig, Event, Comment, Discussion } = input;
  return createSuspensionResolver({
    Issue,
    Channel,
    ServerConfig,
    Event,
    Comment,
    Discussion,
    issueRelatedAccountField: "relatedUsername",
    channelSuspendedField: "SuspendedUsers",
    suspendedEntityName: "user",
    suspensionCommentText: "The user has been suspended.",
  });
}

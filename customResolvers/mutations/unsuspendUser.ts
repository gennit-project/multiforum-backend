import type { IssueModel, ChannelModel, CommentModel, DiscussionModel, EventModel, ServerConfigModel } from "../../ogm_types.js";
import { createUnsuspendResolver } from "./shared/createUnsuspendResolver.js";

type Input = {
  Issue: IssueModel;
  Channel: ChannelModel;
  ServerConfig: ServerConfigModel;
  Comment: CommentModel;
  Discussion: DiscussionModel;
  Event: EventModel;
};

export default function getResolver(input: Input) {
  const { Issue, Channel, ServerConfig, Event, Comment, Discussion } = input;
  return createUnsuspendResolver({
    Issue,
    Channel,
    ServerConfig,
    Comment,
    Discussion,
    Event,
    issueRelatedAccountField: "relatedUsername",
    channelSuspendedField: "SuspendedUsers",
    suspendedEntityName: "user",
    unsuspendCommentText: "The user has been unsuspended."
  });
}

import type { IssueModel, ChannelModel, EventModel, DiscussionModel, CommentModel, ServerConfigModel, UserModel } from "../../ogm_types.js";
import { createSuspensionResolver } from "./shared/createSuspensionResolver.js";

type Input = {
  Issue: IssueModel;
  Channel: ChannelModel;
  ServerConfig: ServerConfigModel;
  Event: EventModel;
  Comment: CommentModel;
  Discussion: DiscussionModel;
  User: UserModel;
};

export default function getResolver(input: Input) {
  const {
    Issue,
    Channel,
    ServerConfig,
    Comment,
    Event,
    Discussion,
    User
  } = input;
  return createSuspensionResolver({
    Issue,
    Channel,
    ServerConfig,
    Comment,
    Event,
    Discussion,
    User,
    issueRelatedAccountField: "relatedModProfileName",
    channelSuspendedField: "SuspendedMods",
    suspendedEntityName: "mod",
    suspensionCommentText: "The mod has been suspended.",
  });
}

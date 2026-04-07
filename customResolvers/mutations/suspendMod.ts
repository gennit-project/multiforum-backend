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
  const { 
    Issue, 
    Channel,
    ServerConfig,
    Comment,
    Event,
    Discussion
  } = input;
  return createSuspensionResolver({
    Issue,
    Channel,
    ServerConfig,
    Comment,
    Event,
    Discussion,
    issueRelatedAccountField: "relatedModProfileName",
    channelSuspendedField: "SuspendedMods",
    suspendedEntityName: "mod",
    suspensionCommentText: "The mod has been suspended.",
  });
}

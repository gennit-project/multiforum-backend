import type { IssueModel, ChannelModel, ServerConfigModel } from "../../ogm_types.js";
import { createSuspensionResolver } from "./shared/createSuspensionResolver.js";

type Input = {
  Issue: IssueModel;
  Channel: ChannelModel;
  ServerConfig: ServerConfigModel;
};

export default function getResolver(input: Input) {
  const { Issue, Channel, ServerConfig } = input;
  return createSuspensionResolver({
    Issue,
    Channel,
    ServerConfig,
    issueRelatedAccountField: "relatedModProfileName",
    channelSuspendedField: "SuspendedMods",
    suspendedEntityName: "mod",
    suspensionCommentText: "The mod has been suspended.",
  });
}

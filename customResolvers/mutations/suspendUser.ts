import type { IssueModel, ChannelModel, ServerConfigModel } from "../../ogm_types.js";
import { createSuspensionResolver } from "./shared/createSuspensionResolver.js";

type Input = {
  includeWikiPage?: boolean;
  includeTextVersion?: boolean;
  Issue: IssueModel;
  Channel: ChannelModel;
  ServerConfig: ServerConfigModel;
};

export default function getResolver(input: Input) {
  const { Issue, Channel, ServerConfig, includeWikiPage, includeTextVersion } = input;
  return createSuspensionResolver({
    Issue,
    Channel,
    ServerConfig,
    includeWikiPage,
    includeTextVersion,
    issueRelatedAccountField: "relatedUsername",
    channelSuspendedField: "SuspendedUsers",
    suspendedEntityName: "user",
    suspensionCommentText: "The user has been suspended.",
  });
}

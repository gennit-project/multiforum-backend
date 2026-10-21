import { createSuspensionResolver } from "./shared/createSuspensionResolver.js";

type Input = {
  includeWikiPage?: boolean;
  includeTextVersion?: boolean;
};

export default function getResolver(input: Input) {
  const { includeWikiPage, includeTextVersion } = input;
  return createSuspensionResolver({
    includeWikiPage,
    includeTextVersion,
    issueRelatedAccountField: "relatedUsername",
    channelSuspendedField: "SuspendedUsers",
    suspendedEntityName: "user",
    suspensionCommentText: "The user has been suspended.",
  });
}

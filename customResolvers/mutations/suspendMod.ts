import { createSuspensionResolver } from "./shared/createSuspensionResolver.js";


export default function getResolver() {
  return createSuspensionResolver({
    issueRelatedAccountField: "relatedModProfileName",
    channelSuspendedField: "SuspendedMods",
    suspendedEntityName: "mod",
    suspensionCommentText: "The mod has been suspended.",
  });
}

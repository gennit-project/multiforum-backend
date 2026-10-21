import { createUnsuspendResolver } from "./shared/createUnsuspendResolver.js";


export default function getResolver() {
  return createUnsuspendResolver({
    issueRelatedAccountField: "relatedUsername",
    channelSuspendedField: "SuspendedUsers",
    suspendedEntityName: "user",
    unsuspendCommentText: "The user has been unsuspended."
  });
}

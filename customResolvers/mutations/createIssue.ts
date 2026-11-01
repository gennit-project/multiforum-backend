import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import { createSubmittedIssue } from "../../services/persistence/issueSubmissionRepository.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import { createInstancePolicyRepository } from "../../services/persistence/instancePolicyRepository.js";
import type { SubmitIssueInput } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { extractIssueIdentityEdges, validateIssueIdentityInput } from "../../services/issueTargetIdentity.js";

export default function getResolver({ driver }: { driver: Driver }) {
  return async (_parent: unknown, { input }: { input: SubmitIssueInput }, context: GraphQLContext) => {
    context.user = await setUserDataOnContext({ context });
    const username = context.user?.username;
    if (!username) throw new GraphQLError("Authentication required.");
    const { asModerationProfile, ...fields } = input;
    if (input.channelUniqueName != null && !input.channelUniqueName.trim()) throw new GraphQLError("Channel cannot be empty.");
    const authorName = asModerationProfile
      ? context.user?.data?.ModerationProfile?.displayName : username;
    if (!authorName) throw new GraphQLError("A moderation profile is required.");
    if (!input.title.trim() || !input.body.trim()) throw new GraphQLError("Title and body are required.");
    const authorType = asModerationProfile ? "ModerationProfile" : "User";
    const authorKey = asModerationProfile ? "displayName" : "username";
    const identity = {
      ...fields, authorName,
      Author: { [authorType]: { connect: { where: { node: { [authorKey]: authorName } } } } },
    };
    // Validate shape and mutually exclusive targets before any number is allocated.
    validateIssueIdentityInput(identity, { allowUntargeted: true, requireNumber: false });
    const contentTarget = input.relatedDiscussionId || input.relatedCommentId || input.relatedEventId || input.relatedWikiPageId || input.relatedImageId || input.relatedAlbumId || input.relatedChannelUniqueName;
    if (contentTarget && (input.relatedUsername || input.relatedModProfileName)) {
      throw new GraphQLError("Supply the content target without an additional author target.");
    }
    const edges = extractIssueIdentityEdges(identity);
    const sensitive = await mayAccessSensitiveContent({context,driver,agePolicyRepository:createInstancePolicyRepository(driver)});
    return createSubmittedIssue(driver,input,authorName,edges,sensitive);
  };
}

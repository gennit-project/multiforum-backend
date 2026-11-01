import { GraphQLError } from "graphql";
import type { ManagedTransaction } from "neo4j-driver";
import type { SubmitIssueInput } from "../../src/generated/graphql.js";

// Explicit routes from a target to its forum. A target in another forum must
// not become actionable merely by putting that forum's name on an issue.
const routes: ReadonlyArray<[keyof SubmitIssueInput, string]> = [
  ["relatedDiscussionId", "(:Discussion {id:$id})<-[:POSTED_IN_CHANNEL]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(c)"],
  ["relatedEventId", "(:Event {id:$id})<-[:POSTED_IN_CHANNEL]-(:EventChannel)-[:POSTED_IN_CHANNEL]->(c)"],
  ["relatedWikiPageId", "(:WikiPage {id:$id})<-[:OWNS_WIKI_PAGE]-(c)"],
  ["relatedAlbumId", "(:Album {id:$id})<-[:HAS_ALBUM]-(:Discussion)<-[:POSTED_IN_CHANNEL]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(c)"],
  ["relatedImageId", "(:Image {id:$id})<-[:HAS_IMAGE]-(:Album)<-[:HAS_ALBUM]-(:Discussion)<-[:POSTED_IN_CHANNEL]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(c)"],
];
export async function assertIssueSubmissionScope(tx:ManagedTransaction,input:SubmitIssueInput) {
  if (!input.channelUniqueName) return;
  for (const [field, pattern] of routes) {
    if (!input[field]) continue;
    const result=await tx.run(`MATCH (c:Channel {uniqueName:$channel}) RETURN EXISTS { MATCH ${pattern} } AS allowed`,
      {channel:input.channelUniqueName,id:input[field]});
    if (result.records[0]?.get("allowed") !== true) throw new GraphQLError("Issue target does not belong to this channel.");
  }
  if (input.relatedChannelUniqueName && input.relatedChannelUniqueName !== input.channelUniqueName) {
    throw new GraphQLError("Issue target does not belong to this channel.");
  }
  if (input.relatedCommentId) {
    const result=await tx.run(`MATCH (c:Channel {uniqueName:$channel})
      MATCH (:Comment {id:$id})-[:IS_REPLY_TO*0..32]->(root:Comment)
      RETURN any(allowed IN collect(
        EXISTS { MATCH (c)<-[:POSTED_IN_CHANNEL]-(:DiscussionChannel)-[:CONTAINS_COMMENT]->(root) }
        OR EXISTS { MATCH (c)-[:HAS_COMMENT]->(root) }
        OR EXISTS { MATCH (c)<-[:POSTED_IN_CHANNEL]-(:EventChannel)-[:POSTED_IN_CHANNEL]->(:Event)-[:HAS_COMMENT]->(root) }
        OR EXISTS { MATCH (root)-[:HAS_FEEDBACK_COMMENT]->(:Discussion)<-[:POSTED_IN_CHANNEL]-(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(c) }
      ) WHERE allowed) AS allowed`,{channel:input.channelUniqueName,id:input.relatedCommentId});
    if (result.records[0]?.get("allowed") !== true) throw new GraphQLError("Issue target does not belong to this channel.");
  }
}

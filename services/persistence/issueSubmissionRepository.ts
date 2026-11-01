import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { SubmitIssueInput } from "../../src/generated/graphql.js";
import type { IssueIdentityEdge } from "../issueTargetIdentity.js";
import { executeManagedWrite } from "../neo4jTransactions.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { assertIssueSubmissionScope } from "./issueSubmissionScope.js";

export async function createSubmittedIssue(driver: Driver, input: SubmitIssueInput,
  authorName: string, edges: IssueIdentityEdge[], sensitive: boolean) {
  const {asModerationProfile: _persona, ...fields} = input;
  void _persona;
  return executeManagedWrite(driver, async tx => {
      // All required endpoints must exist. A missing reference rolls back the
      // entire write, including the counter; best-effort identity is unsafe.
      for (const edge of edges) {
        const result = await tx.run(
          `MATCH (t:${edge.targetLabel} {${edge.targetKey}: $value})
           WHERE $sensitive OR (coalesce(t.hasSensitiveContent,false) = false AND coalesce(t.ageGateRestricted,false) = false)
           RETURN count(t) AS count`,
          { value: edge.value, sensitive });
        if (Number(result.records[0]?.get("count")) !== 1) throw new GraphQLError("Issue identity or target not found.");
      }
      if (input.relatedWikiRevisionId) {
        const result = await tx.run(`MATCH (:WikiPage {id:$page})-[:HAS_VERSION]->(:TextVersion {id:$revision}) RETURN count(*) AS count`,
          {page:input.relatedWikiPageId,revision:input.relatedWikiRevisionId});
        if (Number(result.records[0]?.get("count")) !== 1) throw new GraphQLError("Revision does not belong to the wiki page.");
      }
      await assertIssueSubmissionScope(tx,input);
      const number = await tx.run(`
        MERGE (counter:${input.channelUniqueName ? "ChannelIssueCounter {channelUniqueName: $channel}" : "ServerIssueCounter {scope: 'server'}"})
        ON CREATE SET counter.current = 0
        SET counter.current = counter.current
        WITH counter
        OPTIONAL MATCH (i:Issue)
        WHERE ($channel IS NULL AND i.channelUniqueName IS NULL) OR i.channelUniqueName = $channel
        WITH counter, coalesce(max(i.issueNumber), 0) AS highest
        SET counter.current = CASE WHEN counter.current < highest THEN highest ELSE counter.current END + 1
        RETURN counter.current AS number`,
        {channel:input.channelUniqueName ?? null});
      const issueNumber = Number(number.records[0].get("number"));
      const result = await executeGeneratedOperation<{createIssues:{issues:Array<{id:string;issueNumber:number}>}}>(driver,
        `mutation SubmitIssue($input:[IssueCreateInput!]!){createIssues(input:$input){issues{id issueNumber}}}`,
        {input:[{...fields,authorName,issueNumber,isOpen:true,flaggedServerRuleViolation:false}]},tx);
      const issue = result.createIssues.issues[0];
      for (const edge of edges) {
        const relationship = edge.direction === "IN" ? `(t)-[:${edge.relationshipType}]->(i)` : `(i)-[:${edge.relationshipType}]->(t)`;
        await tx.run(`MATCH (i:Issue {id:$id}), (t:${edge.targetLabel} {${edge.targetKey}:$value}) MERGE ${relationship}`,
          {id:issue.id,value:edge.value});
      }
      const read = await executeGeneratedOperation<{issues:Array<{id:string;issueNumber:number}>}>(driver,
        `query SubmittedIssue($id:ID!){issues(where:{id:{eq:$id}}){id issueNumber title body isOpen channelUniqueName authorName createdAt updatedAt relatedCommentId relatedDiscussionId relatedEventId relatedWikiPageId relatedWikiRevisionId relatedImageId relatedAlbumId relatedUsername relatedModProfileName relatedChannelUniqueName flaggedServerRuleViolation Channel{uniqueName} Author{... on User{username} ... on ModerationProfile{displayName}}}}`,{id:issue.id},tx,{mayAccessSensitiveContent:sensitive});
      return read.issues[0];
    });
}

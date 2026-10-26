import type { Driver } from "neo4j-driver";
import type { IssueCreateInput } from "../../src/generated/graphql.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import {
  extractIssueIdentityEdges,
  issueIdentityRelationshipFields,
  type IssueIdentityEdge,
} from "../issueTargetIdentity.js";

export type CreatedIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null };
export interface IssueCreationRepository {
  create(input: IssueCreateInput): Promise<CreatedIssue | undefined>;
}
const CREATE_ISSUE = `mutation CreateNumberedIssue($input: [IssueCreateInput!]!) {
  createIssues(input: $input) { issues { id issueNumber flaggedServerRuleViolation } }
}`;
// v7 removed to-one connect from create inputs; own each identity edge with a
// best-effort MERGE. Relationship type / target label / key come from the
// static issue-target definitions, never from user input.
const connectIdentityEdge = async (driver: Driver, issueId: string, edge: IssueIdentityEdge) => {
  const merge = edge.direction === "IN"
    ? `MERGE (t)-[:${edge.relationshipType}]->(i)`
    : `MERGE (i)-[:${edge.relationshipType}]->(t)`;
  await driver.executeQuery(
    `MATCH (i:Issue {id: $id})
     OPTIONAL MATCH (t:${edge.targetLabel} {${edge.targetKey}: $value})
     FOREACH (_ IN CASE WHEN t IS NULL THEN [] ELSE [1] END | ${merge})`,
    {id: issueId, value: edge.value});
};
// Identity attachment belongs to the caller, after its separate number allocation.
export function createIssueCreationRepository(driver: Driver): IssueCreationRepository {
  return { async create(input) {
    const edges = extractIssueIdentityEdges(input as Record<string, unknown>);
    const scalars: Record<string, unknown> = {...(input as Record<string, unknown>)};
    for (const field of issueIdentityRelationshipFields) delete scalars[field];
    const result = await executeGeneratedOperation<{createIssues: {issues: CreatedIssue[]}}>(driver, CREATE_ISSUE, {input: [scalars]});
    const issue = result.createIssues.issues?.[0];
    if (issue?.id) for (const edge of edges) await connectIdentityEdge(driver, issue.id, edge);
    return issue;
  } };
}

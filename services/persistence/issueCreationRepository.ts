import type { Driver } from "neo4j-driver";
import type { IssueCreateInput } from "../../src/generated/graphql.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type CreatedIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null };
export interface IssueCreationRepository {
  create(input: IssueCreateInput): Promise<CreatedIssue | undefined>;
}
const CREATE_ISSUE = `mutation CreateNumberedIssue($input: [IssueCreateInput!]!) {
  createIssues(input: $input) { issues { id issueNumber flaggedServerRuleViolation } }
}`;
// Identity attachment belongs to the caller, after its separate number allocation.
export function createIssueCreationRepository(driver: Driver): IssueCreationRepository {
  return { async create(input) {
    const result = await executeGeneratedOperation<{createIssues: {issues: CreatedIssue[]}}>(driver, CREATE_ISSUE, {input: [input]});
    return result.createIssues.issues?.[0];
  } };
}

import type { Driver } from "neo4j-driver";
import type { IssueCreateInput, IssueUpdateInput, IssueWhere } from "../../ogm_types.js";
import { attachIssueIdentityRelationships, assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

type ReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null; relatedImageId?: string | null };
export interface ImageReportRepository {
  findReportedImage(id: string): Promise<Array<{ id: string; url?: string | null; Uploader?: { username: string } | null }>>;
  findPriorImageReport(where: IssueWhere): Promise<Array<ReportIssue & { relatedUsername?: string | null }>>;
  createImageReportIssue(input: IssueCreateInput): Promise<{ issues: ReportIssue[] }>;
  appendImageReport(where: IssueWhere, update: IssueUpdateInput): Promise<{ issues: ReportIssue[] }>;
}
const IMAGE = `query ImageReportTarget($where: ImageWhere) { images(where: $where) { id url Uploader { username } } }`;
const PRIOR = `query PriorImageReport($where: IssueWhere) { issues(where: $where) { id issueNumber flaggedServerRuleViolation relatedUsername } }`;
const CREATE = `mutation CreateImageReportIssue($input: [IssueCreateInput!]!) { createIssues(input: $input) { issues { id issueNumber flaggedServerRuleViolation } } }`;
const APPEND = `mutation AppendImageReport($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where: $where, update: $update) { issues { id issueNumber flaggedServerRuleViolation relatedImageId } } }`;
export function createImageReportRepository(driver: Driver): ImageReportRepository {
  return {
    async findReportedImage(id) { return (await executeGeneratedOperation<{images: Awaited<ReturnType<ImageReportRepository['findReportedImage']>>}>(driver, IMAGE, {where: {id}})).images; },
    async findPriorImageReport(where) { return (await executeGeneratedOperation<{issues: Awaited<ReturnType<ImageReportRepository['findPriorImageReport']>>}>(driver, PRIOR, {where})).issues; },
    async createImageReportIssue(input) { return (await executeGeneratedOperation<{createIssues: {issues: ReportIssue[]}}>(driver, CREATE, {input: [attachIssueIdentityRelationships(input)]})).createIssues; },
    async appendImageReport(where, update) { assertIssueIdentityUpdateAllowed(update); return (await executeGeneratedOperation<{updateIssues: {issues: ReportIssue[]}}>(driver, APPEND, {where, update})).updateIssues; },
  };
}

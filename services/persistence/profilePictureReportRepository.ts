import type { Driver } from "neo4j-driver";
import type { IssueCreateInput, IssueUpdateInput, IssueWhere } from "../../ogm_types.js";
import { attachIssueIdentityRelationships, assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

type ReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null; relatedProfilePicUserId?: string | null };
export interface ProfilePictureReportRepository {
  findReportedProfile(username: string): Promise<Array<{ username: string; displayName?: string | null; profilePicURL?: string | null }>>;
  findPriorProfileReport(username: string): Promise<Array<ReportIssue>>;
  createProfileReportIssue(input: IssueCreateInput): Promise<{ issues: ReportIssue[] }>;
  appendProfileReport(where: IssueWhere, update: IssueUpdateInput): Promise<{ issues: ReportIssue[] }>;
}
const PROFILE = `query ProfileReportTarget($where: UserWhere) { users(where: $where) { username displayName profilePicURL } }`;
const PRIOR = `query PriorProfilePictureReport($where: IssueWhere) { issues(where: $where) { id issueNumber flaggedServerRuleViolation } }`;
const CREATE = `mutation CreateProfilePictureReportIssue($input: [IssueCreateInput!]!) { createIssues(input: $input) { issues { id issueNumber flaggedServerRuleViolation } } }`;
const APPEND = `mutation AppendProfilePictureReport($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where: $where, update: $update) { issues { id issueNumber flaggedServerRuleViolation relatedProfilePicUserId } } }`;
export function createProfilePictureReportRepository(driver: Driver): ProfilePictureReportRepository {
  return {
    async findReportedProfile(username) { return (await executeGeneratedOperation<{users: Awaited<ReturnType<ProfilePictureReportRepository['findReportedProfile']>>}>(driver, PROFILE, {where: {username}})).users; },
    async findPriorProfileReport(username) { return (await executeGeneratedOperation<{issues: Awaited<ReturnType<ProfilePictureReportRepository['findPriorProfileReport']>>}>(driver, PRIOR, {where: {channelUniqueName: null, relatedProfilePicUserId: username}})).issues; },
    async createProfileReportIssue(input) { return (await executeGeneratedOperation<{createIssues: {issues: ReportIssue[]}}>(driver, CREATE, {input: [attachIssueIdentityRelationships(input)]})).createIssues; },
    async appendProfileReport(where, update) { assertIssueIdentityUpdateAllowed(update); return (await executeGeneratedOperation<{updateIssues: {issues: ReportIssue[]}}>(driver, APPEND, {where, update})).updateIssues; },
  };
}

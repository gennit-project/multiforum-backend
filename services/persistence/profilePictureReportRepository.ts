import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from "./moderationIssueWrites.js";

type ReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null; relatedProfilePicUserId?: string | null };
export interface ProfilePictureReportRepository {
  findReportedProfile(username: string): Promise<Array<{ username: string; displayName?: string | null; profilePicURL?: string | null }>>;
  findPriorProfileReport(username: string): Promise<Array<ReportIssue>>;
  // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
  // owned Cypher (moderationIssueWrites); reads stay on the generated API.
  createProfileReportIssue(params: CreateModerationIssueParams): Promise<{ issues: ReportIssue[] }>;
  appendProfileReport(params: AppendModerationActionsParams): Promise<{ issues: ReportIssue[] }>;
}
const PROFILE = `query ProfileReportTarget($where: UserWhere) { users(where: $where) { username displayName profilePicURL } }`;
const PRIOR = `query PriorProfilePictureReport($where: IssueWhere) { issues(where: $where) { id issueNumber flaggedServerRuleViolation } }`;
export function createProfilePictureReportRepository(driver: Driver): ProfilePictureReportRepository {
  return {
    async findReportedProfile(username) { return (await executeGeneratedOperation<{users: Awaited<ReturnType<ProfilePictureReportRepository['findReportedProfile']>>}>(driver, PROFILE, {where: {username: {eq: username}}})).users; },
    async findPriorProfileReport(username) { return (await executeGeneratedOperation<{issues: Awaited<ReturnType<ProfilePictureReportRepository['findPriorProfileReport']>>}>(driver, PRIOR, {where: {channelUniqueName: {eq: null}, relatedProfilePicUserId: {eq: username}}})).issues; },
    async createProfileReportIssue(params) { const issue = await createModerationIssue(driver, params); return { issues: [issue as ReportIssue] }; },
    async appendProfileReport(params) { const result = await appendModerationActions(driver, params); return { issues: result.issues as ReportIssue[] }; },
  };
}

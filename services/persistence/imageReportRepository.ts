import type { Driver } from "neo4j-driver";
import type { IssueWhere } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from "./moderationIssueWrites.js";

type ReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null; relatedImageId?: string | null };
export interface ImageReportRepository {
  findReportedImage(id: string): Promise<Array<{ id: string; url?: string | null; Uploader?: { username: string } | null }>>;
  findPriorImageReport(where: IssueWhere): Promise<Array<ReportIssue & { relatedUsername?: string | null }>>;
  // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
  // owned Cypher (moderationIssueWrites); reads stay on the generated API.
  createImageReportIssue(params: CreateModerationIssueParams): Promise<{ issues: ReportIssue[] }>;
  appendImageReport(params: AppendModerationActionsParams): Promise<{ issues: ReportIssue[] }>;
}
const IMAGE = `query ImageReportTarget($where: ImageWhere) { images(where: $where) { id url Uploader { username } } }`;
const PRIOR = `query PriorImageReport($where: IssueWhere) { issues(where: $where) { id issueNumber flaggedServerRuleViolation relatedUsername } }`;
export function createImageReportRepository(driver: Driver): ImageReportRepository {
  return {
    async findReportedImage(id) { return (await executeGeneratedOperation<{images: Awaited<ReturnType<ImageReportRepository['findReportedImage']>>}>(driver, IMAGE, {where: {id: {eq: id}}})).images; },
    async findPriorImageReport(where) { return (await executeGeneratedOperation<{issues: Awaited<ReturnType<ImageReportRepository['findPriorImageReport']>>}>(driver, PRIOR, {where})).issues; },
    async createImageReportIssue(params) { const issue = await createModerationIssue(driver, params); return { issues: [issue as ReportIssue] }; },
    async appendImageReport(params) { const result = await appendModerationActions(driver, params); return { issues: result.issues as ReportIssue[] }; },
  };
}

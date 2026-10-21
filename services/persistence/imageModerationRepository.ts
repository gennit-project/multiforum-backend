import type { Driver } from "neo4j-driver";
import type { Image, Issue, IssueCreateInput, IssueWhere, IssueUpdateInput, ImageWhere, ImageUpdateInput } from "../../ogm_types.js";
import { attachIssueIdentityRelationships, assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export interface ImageModerationRepository {
  findArchiveTarget(id: string): Promise<Image[]>;
  findUnarchiveTarget(id: string): Promise<Image[]>;
  findIssue(where: IssueWhere): Promise<Issue[]>;
  createModerationIssue(input: IssueCreateInput): Promise<{issues: Issue[]}>;
  appendIssueAction(where: IssueWhere, update: IssueUpdateInput): Promise<{issues: Issue[]}>;
  updateModerationState(where: ImageWhere, update: ImageUpdateInput): Promise<{images: Image[]}>;
}
export const ARCHIVE_IMAGE_SELECTION = `{
        id
        url
        archived
        Uploader {
          username
        }
      }`;
const ARCHIVE_TARGET = `query ArchiveImageTarget($where: ImageWhere!) { images(where: $where) ${ARCHIVE_IMAGE_SELECTION} }`;
export const UNARCHIVE_IMAGE_SELECTION = `{
        id
        archived
      }`;
const UNARCHIVE_TARGET = `query UnarchiveImageTarget($where: ImageWhere!) { images(where: $where) ${UNARCHIVE_IMAGE_SELECTION} }`;
export const IMAGE_MODERATION_DEFAULT_SELECTION = `{
  id
  url
  width
  height
  list80Url
  list160Url
  list320Url
  detail640Url
  detail960Url
  detail1280Url
  storageBucket
  storageObjectName
  storageUrl
  uploadedByUsername
  uploadedByIp
  alt
  caption
  longDescription
  copyright
  hasSensitiveContent
  hasSpoiler
  archived
  permanentlyRemoved
  permanentlyRemovedByUsername
  permanentlyRemovedByModName
  variantUrls
  scanStatus
  uploadedAt
  createdAt
  scanCheckedAt
  permanentlyRemovedAt
}`;

const ISSUE_SELECTION = `{ id issueNumber flaggedServerRuleViolation }`;
const FIND_ISSUE = `query ImageModerationIssue($where: IssueWhere!) { issues(where: $where) ${ISSUE_SELECTION} }`;
const CREATE_ISSUE = `mutation CreateImageModerationIssue($input: [IssueCreateInput!]!) { createIssues(input: $input) { issues ${ISSUE_SELECTION} } }`;
const UPDATE_ISSUE = `mutation AppendImageModerationAction($where: IssueWhere!, $update: IssueUpdateInput!) { updateIssues(where: $where, update: $update) { issues ${ISSUE_SELECTION} } }`;
const UPDATE_IMAGE = `mutation SetImageModerationState($where: ImageWhere!, $update: ImageUpdateInput!) { updateImages(where: $where, update: $update) { images ${IMAGE_MODERATION_DEFAULT_SELECTION} } }`;
export function createImageModerationRepository(driver: Driver): ImageModerationRepository {
  return {
    async findArchiveTarget(id) {
      return (await executeGeneratedOperation<{images: Image[]}>(driver, ARCHIVE_TARGET, {where: {id}})).images;
    },
    async findUnarchiveTarget(id) {
      return (await executeGeneratedOperation<{images: Image[]}>(driver, UNARCHIVE_TARGET, {where: {id}})).images;
    },
    async findIssue(where) {
      return (await executeGeneratedOperation<{issues: Issue[]}>(driver, FIND_ISSUE, {where})).issues;
    },
    async createModerationIssue(input) {
      const attached = attachIssueIdentityRelationships(input);
      return (await executeGeneratedOperation<{createIssues: {issues: Issue[]}}>(driver, CREATE_ISSUE, {input: [attached]})).createIssues;
    },
    async appendIssueAction(where, update) {
      assertIssueIdentityUpdateAllowed(update);
      return (await executeGeneratedOperation<{updateIssues: {issues: Issue[]}}>(driver, UPDATE_ISSUE, {where, update})).updateIssues;
    },
    async updateModerationState(where, update) {
      return (await executeGeneratedOperation<{updateImages: {images: Image[]}}>(driver, UPDATE_IMAGE, {where, update})).updateImages;
    },
  };
}

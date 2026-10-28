import type { Driver } from "neo4j-driver";
import type { Image, Issue, IssueWhere, ImageWhere, ImageUpdateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import {
  createModerationIssue as createModerationIssueWrite,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from "./moderationIssueWrites.js";

export interface ImageModerationRepository {
  findPermanentRemovalTarget(id: string): Promise<Image[]>;
  findArchiveTarget(id: string): Promise<Image[]>;
  findUnarchiveTarget(id: string): Promise<Image[]>;
  findIssue(where: IssueWhere): Promise<Issue[]>;
  // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
  // owned Cypher (moderationIssueWrites). updateModerationState stays on the
  // generated API for archive/unarchive (archived scalar + to-many RelatedIssues);
  // the permanentlyRemoveImage PermanentlyRemovedByMod to-one connect is wired by
  // the resolver via connectPermanentlyRemovedByMod.
  createModerationIssue(params: CreateModerationIssueParams): Promise<{issues: Issue[]}>;
  appendIssueAction(params: AppendModerationActionsParams): Promise<{issues: Issue[]}>;
  updateModerationState(where: ImageWhere, update: ImageUpdateInput): Promise<{images: Image[]}>;
  connectPermanentlyRemovedByMod(imageId: string, modDisplayName: string): Promise<void>;
}
export const PERMANENT_REMOVAL_IMAGE_SELECTION = `{
        id
        url
        permanentlyRemoved
        Uploader {
          username
        }
      }`;
const PERMANENT_TARGET = `query PermanentImageRemovalTarget($where: ImageWhere!) { images(where: $where) ${PERMANENT_REMOVAL_IMAGE_SELECTION} }`;
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

const FIND_ISSUE = `query ImageModerationIssue($where: IssueWhere!) { issues(where: $where) { id issueNumber flaggedServerRuleViolation } }`;
const UPDATE_IMAGE = `mutation SetImageModerationState($where: ImageWhere!, $update: ImageUpdateInput!) { updateImages(where: $where, update: $update) { images ${IMAGE_MODERATION_DEFAULT_SELECTION} } }`;
// PermanentlyRemovedByMod is a to-one relationship (v7 removed nested connect for
// it); wire it with best-effort owned Cypher. Image.PermanentlyRemovedByMod is a
// to-one @relationship; mirror its type/direction from typeDefs.
const CONNECT_REMOVED_BY_MOD = `
 MATCH (img:Image {id: $imageId})
 WITH img
 OPTIONAL MATCH (mod:ModerationProfile {displayName: $modDisplayName})
 FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END |
  MERGE (mod)-[:REMOVED_IMAGE]->(img)
 )
`;
export function createImageModerationRepository(driver: Driver): ImageModerationRepository {
  return {
    async findPermanentRemovalTarget(id) {
      return (await executeGeneratedOperation<{images: Image[]}>(driver, PERMANENT_TARGET, {where: {id: {eq: id}}})).images;
    },
    async findArchiveTarget(id) {
      return (await executeGeneratedOperation<{images: Image[]}>(driver, ARCHIVE_TARGET, {where: {id: {eq: id}}})).images;
    },
    async findUnarchiveTarget(id) {
      return (await executeGeneratedOperation<{images: Image[]}>(driver, UNARCHIVE_TARGET, {where: {id: {eq: id}}})).images;
    },
    async findIssue(where) {
      return (await executeGeneratedOperation<{issues: Issue[]}>(driver, FIND_ISSUE, {where})).issues;
    },
    async createModerationIssue(params) {
      const issue = await createModerationIssueWrite(driver, params);
      return { issues: [issue as unknown as Issue] };
    },
    async appendIssueAction(params) {
      const result = await appendModerationActions(driver, params);
      return { issues: result.issues as unknown as Issue[] };
    },
    async updateModerationState(where, update) {
      return (await executeGeneratedOperation<{updateImages: {images: Image[]}}>(driver, UPDATE_IMAGE, {where, update})).updateImages;
    },
    async connectPermanentlyRemovedByMod(imageId, modDisplayName) {
      await driver.executeQuery(CONNECT_REMOVED_BY_MOD, {imageId, modDisplayName});
    },
  };
}

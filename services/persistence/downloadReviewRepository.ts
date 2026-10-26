import type { Driver } from "neo4j-driver";
import type { DownloadableFile, DownloadableFileUpdateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

// v7 removed flat scalar updates; wrap each field as { set: value }.
const setifyUpdate = (update: DownloadableFileUpdateInput): Record<string, unknown> =>
  Object.fromEntries(Object.entries(update as Record<string, unknown>).map(([key, value]) => [key, { set: value }]));

export const DOWNLOAD_REVIEW_DEFAULT_SELECTION = `{
  id
  fileName
  size
  url
  storageBucket
  storageObjectName
  storageUrl
  uploadedByUsername
  uploadedByIp
  permanentlyRemoved
  permanentlyRemovedByUsername
  permanentlyRemovedByModName
  priceCents
  priceCurrency
  stripeProductId
  stripePriceId
  downloadCountTotal
  downloadCountUnique
  attributionOverride
  supportPatreonUrl
  supportBuyMeACoffeeUrl
  supportKoFiUrl
  supportPayPalMeUrl
  scanReason
  reviewRequestReason
  reviewRequestedByUsername
  kind
  priceModel
  scanStatus
  uploadedAt
  createdAt
  permanentlyRemovedAt
  paywallExpiresAt
  scanCheckedAt
  reviewRequestedAt
}`;
export const FINDPREPARATION_SELECTION = `{
      id
      url
      storageBucket
      storageObjectName
      scanStatus
      scanReason
      scanCheckedAt
      uploadedByUsername
      Discussion { id hasSensitiveContent Author { username } }
    }`;
export const FINDRELEASESTATUS_SELECTION = `{ id scanStatus }`;
export const FINDCLEARED_SELECTION = `{ id fileName scanStatus scanReason scanCheckedAt }`;
export const FINDREVIEWAUTHORITY_SELECTION = `{
        scanStatus
        uploadedByUsername
        Discussion { Author { username } }
      }`;
export const FINDREQUESTED_SELECTION = `{
        id fileName scanStatus scanReason scanCheckedAt
        reviewRequestedAt reviewRequestReason reviewRequestedByUsername
      }`;
export interface DownloadReviewRepository {
  findPreparation(id: string): Promise<DownloadableFile[]>;
  findReleaseStatus(id: string): Promise<DownloadableFile[]>;
  clearScan(id: string, update: DownloadableFileUpdateInput): Promise<void>;
  findCleared(id: string): Promise<DownloadableFile[]>;
  findReviewAuthority(id: string): Promise<DownloadableFile[]>;
  requestReview(id: string, update: DownloadableFileUpdateInput): Promise<void>;
  findRequested(id: string): Promise<DownloadableFile[]>;
}
export function createDownloadReviewRepository(driver: Driver): DownloadReviewRepository {
  return {
    async findPreparation(id) {
      const result = await executeGeneratedOperation<{ downloadableFiles: DownloadableFile[] }>(driver,
        `query DownloadReview_findPreparation($where: DownloadableFileWhere) { downloadableFiles(where: $where) ${FINDPREPARATION_SELECTION} }`, { where: { id: { eq: id } } });
      return result.downloadableFiles;
    },
    async findReleaseStatus(id) {
      const result = await executeGeneratedOperation<{ downloadableFiles: DownloadableFile[] }>(driver,
        `query DownloadReview_findReleaseStatus($where: DownloadableFileWhere) { downloadableFiles(where: $where) ${FINDRELEASESTATUS_SELECTION} }`, { where: { id: { eq: id } } });
      return result.downloadableFiles;
    },
    async clearScan(id, update) {
      // v7 scalar updates take { set: value }; callers pass a flat map.
      await executeGeneratedOperation(driver,
        `mutation DownloadReview_clearScan($where: DownloadableFileWhere, $update: DownloadableFileUpdateInput) { updateDownloadableFiles(where: $where, update: $update) { downloadableFiles ${DOWNLOAD_REVIEW_DEFAULT_SELECTION} } }`,
        { where: { id: { eq: id } }, update: setifyUpdate(update) });
    },
    async findCleared(id) {
      const result = await executeGeneratedOperation<{ downloadableFiles: DownloadableFile[] }>(driver,
        `query DownloadReview_findCleared($where: DownloadableFileWhere) { downloadableFiles(where: $where) ${FINDCLEARED_SELECTION} }`, { where: { id: { eq: id } } });
      return result.downloadableFiles;
    },
    async findReviewAuthority(id) {
      const result = await executeGeneratedOperation<{ downloadableFiles: DownloadableFile[] }>(driver,
        `query DownloadReview_findReviewAuthority($where: DownloadableFileWhere) { downloadableFiles(where: $where) ${FINDREVIEWAUTHORITY_SELECTION} }`, { where: { id: { eq: id } } });
      return result.downloadableFiles;
    },
    async requestReview(id, update) {
      // v7 scalar updates take { set: value }; callers pass a flat map.
      await executeGeneratedOperation(driver,
        `mutation DownloadReview_requestReview($where: DownloadableFileWhere, $update: DownloadableFileUpdateInput) { updateDownloadableFiles(where: $where, update: $update) { downloadableFiles ${DOWNLOAD_REVIEW_DEFAULT_SELECTION} } }`,
        { where: { id: { eq: id } }, update: setifyUpdate(update) });
    },
    async findRequested(id) {
      const result = await executeGeneratedOperation<{ downloadableFiles: DownloadableFile[] }>(driver,
        `query DownloadReview_findRequested($where: DownloadableFileWhere) { downloadableFiles(where: $where) ${FINDREQUESTED_SELECTION} }`, { where: { id: { eq: id } } });
      return result.downloadableFiles;
    },
  };
}

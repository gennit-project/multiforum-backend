import type { Driver } from "neo4j-driver";
import type { DownloadReadSourceQueryResolvers } from "../../customResolvers/contracts/downloadReadSources.js";
import type { UploadedGroupRow, DownloadReviewRow } from "../../customResolvers/contracts/downloadReadProjections.js";
import uploaded from "../../customResolvers/queries/getUploadedDownloadableFiles.js";
import review from "../../customResolvers/queries/getDownloadScanReviewQueue.js";
declare const driver: Driver;
const checked = { getUploadedDownloadableFiles: uploaded({driver}), getDownloadScanReviewQueue: review({driver}) } satisfies DownloadReadSourceQueryResolvers;
declare const group: UploadedGroupRow;
declare const row: DownloadReviewRow;
const uploader: string = group.group.files[0].uploadedByUsername;
// @ts-expect-error nested persisted title is not certified by the relationship fix
const title: string = group.group.discussion.title;
// @ts-expect-error collecting properties does not prove their scalar types
const channels: string[] = group.group.discussion.channelUniqueNames;
// @ts-expect-error raw file name is unknown even with a valid uploader
const filename: string = group.group.files[0].fileName;
// @ts-expect-error author fallback selects a raw property, not a verified string
const author: string = row.review.uploaderUsername;
// @ts-expect-error schema rejects an unknown scan status
const badReview: DownloadReadSourceQueryResolvers["getDownloadScanReviewQueue"] = () => [{scanStatus:"NOT_A_STATUS"}];
// @ts-expect-error uploader values must be strings
const badUpload: DownloadReadSourceQueryResolvers["getUploadedDownloadableFiles"] = () => [{files:[{uploadedByUsername:42}]}];
void [checked,uploader,title,channels,filename,author,badReview,badUpload];

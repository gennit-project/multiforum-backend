import type { Driver } from "neo4j-driver";
import type { DownloadWriteMutationResolvers } from "../../customResolvers/contracts/downloadWrites.js";
import type { CreatedDownloadableFileRow } from "../../customResolvers/mutations/createDownloadableFilesWithUploadMetadata.js";
import type { RemovedUploadColumns } from "../../customResolvers/mutations/permanentlyDeleteStoredUpload.js";
import create from "../../customResolvers/mutations/createDownloadableFilesWithUploadMetadata.js";
import remove from "../../customResolvers/mutations/permanentlyDeleteDownloadableFile.js";
declare const driver: Driver;
const checked = { createDownloadableFiles: create({driver}), permanentlyDeleteDownloadableFile: remove({driver}) } satisfies DownloadWriteMutationResolvers;
declare const raw: CreatedDownloadableFileRow;
const id: string = raw.id;
// @ts-expect-error raw persisted scalar is not a verified GraphQL String
const fileName: string = raw.fileName;
declare const removed: RemovedUploadColumns;
const removedId: string = removed.id;
// @ts-expect-error untouched storage scalar remains unknown
const url: string = removed.url;
// @ts-expect-error actual counters are numeric, not strings
const badCreate: DownloadWriteMutationResolvers["createDownloadableFiles"] = () => ({downloadableFiles:[],info:{nodesCreated:"1",relationshipsCreated:0}});
// @ts-expect-error removal Boolean cannot be a string
const badRemove: DownloadWriteMutationResolvers["permanentlyDeleteDownloadableFile"] = () => ({id:"id",permanentlyRemoved:"true",permanentlyRemovedAt:null,permanentlyRemovedByUsername:null,permanentlyRemovedByModName:null});
void [checked,id,fileName,removedId,url,badCreate,badRemove];

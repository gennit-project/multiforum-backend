import type { RemovedImageColumns, RemovedFileColumns, UploadedItemSource } from '../../customResolvers/contracts/storedUploadSources.js';
import uploaded from '../../customResolvers/queries/getUploadedDownloadableFiles.js';
import type {Driver} from 'neo4j-driver';
declare const driver:Driver;
const actual=uploaded({driver}) satisfies UploadedItemSource;
declare const image:RemovedImageColumns,file:RemovedFileColumns;
const {storageBucket:_bucket,...withoutBucket}=image;
// @ts-expect-error selected nullable column must be present
const missingImage:RemovedImageColumns=withoutBucket;
const {fileName:_name,...withoutName}=file;
// @ts-expect-error file branch emits fileName even when its raw value is null
const missingFile:RemovedFileColumns=withoutName;
// @ts-expect-error image branch does not claim the file-only fields
const filename=image.fileName;
// @ts-expect-error no invented image uploader relationship
const uploader=image.Uploader;
// @ts-expect-error persisted dates retain native raw values
const date:string=file.createdAt;
void[actual,_bucket,missingImage,_name,missingFile,filename,uploader,date];

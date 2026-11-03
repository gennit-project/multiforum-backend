import type { ImageUsageRow } from "../../customResolvers/contracts/imageUsageProjections.js";
declare const row: ImageUsageRow;
const imageId: string=row.usage.imageId;
// @ts-expect-error uploader property is not proven by matching the image ID
const uploader: string=row.usage.uploaderUsername;
// @ts-expect-error nested discussion title is an unknown persisted value
const title: string=row.usage.otherAlbums[0].Discussions[0].title;
// @ts-expect-error raw album map is not an entire generated Album
const album: import("../../src/generated/graphql.js").Album=row.usage.otherAlbums[0];
void [imageId,uploader,title,album];

// Compile-only assertions for the actual object/union checked maps.
import type { CheckedAlbumFields, CheckedAuthorFields, CheckedDownloadableFileFields } from "../../customResolvers/contracts/typeFields.js";
const goodPage: CheckedAlbumFields = { detailImagesPageInfo: () => ({ endCursor: null, hasNextPage: false }) };
// @ts-expect-error non-null page info cannot be absent
const missingPage: CheckedAlbumFields = { detailImagesPageInfo: () => null };
// @ts-expect-error hasNextPage is Boolean, not a count
const badPage: CheckedAlbumFields = { detailImagesPageInfo: () => ({ endCursor: null, hasNextPage: 1 }) };
// @ts-expect-error every page-info response includes the hasNextPage field
const omittedFlag: CheckedAlbumFields = { detailImagesPageInfo: () => ({ endCursor: null }) };
const goodAuthor: CheckedAuthorFields = { __resolveType: () => "User" };
// @ts-expect-error unrelated entity is not a member of the generated union
const badAuthor: CheckedAuthorFields = { __resolveType: () => "Channel" };
const goodUrl: CheckedDownloadableFileFields = { url: async () => "" };
// @ts-expect-error url must be a String
const badUrl: CheckedDownloadableFileFields = { url: async () => ({ url: "example" }) };
void [goodPage, missingPage, badPage, omittedFlag, goodAuthor, badAuthor, goodUrl, badUrl];

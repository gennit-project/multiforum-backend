// Compile-only generated scalar contract regressions.
import type { ContentScalarQueryResolvers } from "../../customResolvers/contracts/contentQueries.js";
import favorite from "../../customResolvers/queries/getUserFavoriteComment.js";
import count from "../../customResolvers/queries/getUserWikiEditsCount.js";
import suspended from "../../customResolvers/queries/isOriginalPosterSuspended.js";

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Favorite = Awaited<ReturnType<ReturnType<typeof favorite>>>;
type Count = Awaited<ReturnType<ReturnType<typeof count>>>;
type Suspended = Awaited<ReturnType<ReturnType<typeof suspended>>>;
const checkedInference: [IsAny<Favorite>, IsAny<Count>, IsAny<Suspended>] = [false, false, false];
const validFavorite: ContentScalarQueryResolvers["getUserFavoriteComment"] = () => false;
const validCount: ContentScalarQueryResolvers["getUserWikiEditsCount"] = () => 0;
const validSuspension: ContentScalarQueryResolvers["isOriginalPosterSuspended"] = () => null;
// @ts-expect-error public Boolean cannot be string
const invalidFavorite: ContentScalarQueryResolvers["getUserFavoriteComment"] = () => "false";
// @ts-expect-error public non-null Int cannot be missing
const missingCount: ContentScalarQueryResolvers["getUserWikiEditsCount"] = () => null;
// @ts-expect-error public Int cannot be a driver Integer-like object
const rawCount: ContentScalarQueryResolvers["getUserWikiEditsCount"] = () => ({ toNumber: () => 2 });
// @ts-expect-error generated args require a string issueId
const invalidArgs: ContentScalarQueryResolvers["isOriginalPosterSuspended"] = (_parent, _args: { issueId: number }) => true;
void [checkedInference, validFavorite, validCount, validSuspension, invalidFavorite, missingCount, rawCount, invalidArgs];

import type { ContentPageQueryResolvers } from "../../customResolvers/contracts/contentQueries.js";
import pages from "../../customResolvers/queries/getSiteWideDiscussionList.js";
import { createDiscussionDetailCollectionPageResolver } from "../../customResolvers/queries/getDiscussionDetailCollectionPage.js";
import type { Driver } from "neo4j-driver";
declare const driver: Driver;
// Actual factory outputs are checked here as well as at production composition.
const pageFactories = {
  getDiscussionDetailAnswers: createDiscussionDetailCollectionPageResolver({ driver, kind: "answer" }),
  getDiscussionDetailFiles: createDiscussionDetailCollectionPageResolver({ driver, kind: "file" }),
  getDiscussionDetailImages: createDiscussionDetailCollectionPageResolver({ driver, kind: "image" }),
  getSiteWideDiscussionList: pages({ driver }),
} satisfies ContentPageQueryResolvers;
// @ts-expect-error pageInfo hasNextPage cannot be a count
const badPage: ContentPageQueryResolvers["getDiscussionDetailAnswers"] = () => ({ pageInfo: { hasNextPage: 1, endCursor: null } });
// @ts-expect-error non-null pagination result must not be missing
const missingPage: ContentPageQueryResolvers["getDiscussionDetailFiles"] = () => undefined;
// @ts-expect-error cursor is a string, not a raw Neo4j value
const badCursor: ContentPageQueryResolvers["getDiscussionDetailImages"] = () => ({ pageInfo: { hasNextPage: false, endCursor: 12 } });
void [pageFactories, badPage, missingPage, badCursor];

import siteWide from '../../customResolvers/queries/getSiteWideDiscussionList.js';
type SiteWideCount = Awaited<ReturnType<ReturnType<typeof siteWide>>>['aggregateDiscussionCount'];
const countIsNotAny:IsAny<SiteWideCount>=false;
// @ts-expect-error a raw count source cannot become arbitrary text
const badSiteWideCount:SiteWideCount='3';
void [countIsNotAny,badSiteWideCount];

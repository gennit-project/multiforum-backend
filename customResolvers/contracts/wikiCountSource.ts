import type {WikiListSource} from './wikiListSource.js';
import type { Integer } from "neo4j-driver";
import type { QueryResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Projection } from "./selection.js";

type Callable = Extract<NonNullable<QueryResolvers<GraphQLContext>["getSiteWideWikiList"]>, (...args: never[]) => unknown>;
type GeneratedOutput = Awaited<ReturnType<Callable>>;
type SelectedOutput = Projection<GeneratedOutput, {aggregateWikiPageCount:true}>;
/** This named field accepts an Integer source because the existing Neo4j
 * numerical child resolver completes it to the generated number output.
 * The real-schema witness guards Int! plus that child resolver dependency.
 * No other scalar or persisted property is widened or certified. */
type WikiCountSource<T> = T extends null | undefined ? T
  : T extends {aggregateWikiPageCount:number}
    ? {aggregateWikiPageCount:number | Integer} : never;
type Source = WikiCountSource<SelectedOutput> | (null extends GeneratedOutput ? undefined : never);
export const wikiCountSourceQueryNames = ["getSiteWideWikiList"] as const;
export type WikiCountSourceQueryResolvers = {
  getSiteWideWikiList: ((...args: Parameters<Callable>) => Source | Promise<Source>) & WikiListSource;
};

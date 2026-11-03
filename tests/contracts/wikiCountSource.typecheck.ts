import type { Driver } from "neo4j-driver";
import neo4j from "neo4j-driver";
import type { WikiCountSourceQueryResolvers } from "../../customResolvers/contracts/wikiCountSource.js";
import wiki from "../../customResolvers/queries/getSiteWideWikiList.js";
declare const driver:Driver;
const checked={getSiteWideWikiList:wiki({driver})} satisfies WikiCountSourceQueryResolvers;
const integerSource:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>({aggregateWikiPageCount:neo4j.int(1)});
const numberSource:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>({aggregateWikiPageCount:1});
const nullRoot:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>null;
// @ts-expect-error string is not a fixed COUNT source even if GraphQL can coerce some strings
const stringSource:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>({aggregateWikiPageCount:'1'});
declare const raw:unknown;
// @ts-expect-error unknown raw value has no numerical provenance
const unknownSource:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>({aggregateWikiPageCount:raw});
// @ts-expect-error only aggregateWikiPageCount is mapped; generated argument types stay intact
const badArgs:Parameters<WikiCountSourceQueryResolvers['getSiteWideWikiList']>[1]={options:{limit:'1'}};
void [checked,integerSource,numberSource,nullRoot,stringSource,unknownSource,badArgs];

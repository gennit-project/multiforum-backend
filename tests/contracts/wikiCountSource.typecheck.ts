import type { Driver } from "neo4j-driver";
import neo4j from "neo4j-driver";
import type { WikiCountSourceQueryResolvers } from "../../customResolvers/contracts/wikiCountSource.js";
import wiki from "../../customResolvers/queries/getSiteWideWikiList.js";
declare const driver:Driver;
const checked={getSiteWideWikiList:wiki({driver})} satisfies WikiCountSourceQueryResolvers;
const integerSource:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>({wikiPages:[],featuredWikiPages:[],aggregateWikiPageCount:neo4j.int(1)});
const numberSource:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>({wikiPages:[],featuredWikiPages:[],aggregateWikiPageCount:1});
const nullRoot:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>null;
// @ts-expect-error string is not a fixed COUNT source even if GraphQL can coerce some strings
const stringSource:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>({wikiPages:[],featuredWikiPages:[],aggregateWikiPageCount:'1'});
declare const raw:unknown;
// @ts-expect-error unknown raw value has no numerical provenance
const unknownSource:WikiCountSourceQueryResolvers['getSiteWideWikiList']=()=>({wikiPages:[],featuredWikiPages:[],aggregateWikiPageCount:raw});
// @ts-expect-error generated argument types stay intact
const badArgs:Parameters<WikiCountSourceQueryResolvers['getSiteWideWikiList']>[1]={options:{limit:'1'}};
void [checked,integerSource,numberSource,nullRoot,stringSource,unknownSource,badArgs];

import type {WikiListItemSource} from '../../customResolvers/contracts/wikiCountProjections.js';
declare const item:WikiListItemSource;
// @ts-expect-error fixed nullable keys cannot disappear
const missing:WikiListItemSource={id:'id'};
// @ts-expect-error a fixed nested author map must retain all selected fields
const author:WikiListItemSource={...item,VersionAuthor:{username:'owner'}};
// @ts-expect-error stored dates are not asserted to be completed strings
const date:string=item.createdAt;
// @ts-expect-error no arbitrary additional relationship is projected
const channel=item.Channel;
void [missing,author,date,channel];

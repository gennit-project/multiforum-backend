import type { Driver } from 'neo4j-driver';
import type { WikiPage, ServerConfig } from '../../ogm_types.js';
import { executeGeneratedOperation } from './generatedSchemaOperations.js';
type ChannelLookup = {uniqueName?: string | null; wikiEnabled?: boolean | null};
type PageLookup = {id?: string | null; Channel?: {uniqueName?: string | null} | null; locked?: boolean | null};
export type WikiLockUpdate = {locked: boolean; lockedAt: string | null; lockReason: string | null; lockedByUsername: string | null};
export interface WikiPinRepository {findChannel(uniqueName: string): Promise<ChannelLookup[]>; findPage(id: string): Promise<PageLookup[]>;}
export interface WikiLockRepository extends WikiPinRepository {updateLock(id: string, update: WikiLockUpdate): Promise<{wikiPages: WikiPage[]}>;}
export interface FeaturedWikiRepository {findServer(serverName: string): Promise<Array<{serverName?:string|null}>>;findPages(ids: string[]): Promise<Array<{id?:string | null}>>;setFeaturedPages(serverName: string, ids:string[]):Promise<{serverConfigs:ServerConfig[]}>;}
export const WIKI_LOCK_RESULT = `{wikiPages {id title body slug channelUniqueName locked lockedAt lockReason lockedByUsername}}`;
export const FEATURED_WIKI_RESULT = `{serverConfigs {serverName featuredWikiPageIds}}`;
const CHANNEL = `query WikiActionChannel($where: ChannelWhere) {channels(where: $where) {uniqueName wikiEnabled}}`;
const PIN_PAGE = `query WikiPinPage($where: WikiPageWhere) {wikiPages(where: $where) {id Channel {uniqueName}}}`;
const LOCK_PAGE = `query WikiLockPage($where: WikiPageWhere) {wikiPages(where: $where) {id Channel {uniqueName} locked}}`;
const LOCK = `mutation SetWikiPageLock($where: WikiPageWhere, $update: WikiPageUpdateInput) {updateWikiPages(where: $where, update: $update) ${WIKI_LOCK_RESULT}}`;
const SERVER = `query FeaturedWikiServer($where: ServerConfigWhere) {serverConfigs(where: $where) {serverName}}`;
const PAGES = `query FeaturedWikiPages($where: WikiPageWhere) {wikiPages(where: $where) {id}}`;
const FEATURED = `mutation SetFeaturedWikiPageIds($where: ServerConfigWhere, $update: ServerConfigUpdateInput) {updateServerConfigs(where: $where, update: $update) ${FEATURED_WIKI_RESULT}}`;
async function findChannel(driver: Driver, uniqueName: string) {return (await executeGeneratedOperation<{channels:ChannelLookup[]}>(driver,CHANNEL,{where:{uniqueName}})).channels;}
export function createWikiPinRepository(driver: Driver): WikiPinRepository {
 return {findChannel:uniqueName=>findChannel(driver,uniqueName),async findPage(id){return (await executeGeneratedOperation<{wikiPages:PageLookup[]}>(driver,PIN_PAGE,{where:{id:{eq:id}}})).wikiPages;}};
}
export function createWikiLockRepository(driver: Driver): WikiLockRepository {
 return {findChannel:uniqueName=>findChannel(driver,uniqueName),async findPage(id){return (await executeGeneratedOperation<{wikiPages:PageLookup[]}>(driver,LOCK_PAGE,{where:{id:{eq:id}}})).wikiPages;},async updateLock(id,update){return (await executeGeneratedOperation<{updateWikiPages:{wikiPages:WikiPage[]}}>(driver,LOCK,{where:{id:{eq:id}},update})).updateWikiPages;}};
}
export function createFeaturedWikiRepository(driver: Driver): FeaturedWikiRepository {
 return {async findServer(serverName){return (await executeGeneratedOperation<{serverConfigs:Array<{serverName?:string|null}>}>(driver,SERVER,{where:{serverName:{eq:serverName}}})).serverConfigs;},async findPages(ids){return (await executeGeneratedOperation<{wikiPages:Array<{id?:string|null}>}>(driver,PAGES,{where:{id:{in:ids}}})).wikiPages;},async setFeaturedPages(serverName,ids){return (await executeGeneratedOperation<{updateServerConfigs:{serverConfigs:ServerConfig[]}}>(driver,FEATURED,{where:{serverName:{eq:serverName}},update:{featuredWikiPageIds:{set:ids}}})).updateServerConfigs;}};
}

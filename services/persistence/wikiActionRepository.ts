import type { Driver } from 'neo4j-driver';
import { executeGeneratedOperation } from './generatedSchemaOperations.js';
export type WikiActionChannel = {uniqueName: string; wikiEnabled: boolean | null};
export type WikiPinPage = {id: string; Channel: {uniqueName: string} | null};
export type WikiLockPage = WikiPinPage & {locked: boolean | null};
export type WikiLockResult = {id: string; title: string; body: string | null; slug: string; channelUniqueName: string; locked: boolean | null; lockedAt: string | null; lockReason: string | null; lockedByUsername: string | null};
export type FeaturedWikiResult = {serverName: string | null; featuredWikiPageIds: string[] | null};
export type WikiLockUpdate = {locked: boolean; lockedAt: string | null; lockReason: string | null; lockedByUsername: string | null};
export interface WikiPinRepository {findChannel(uniqueName: string): Promise<WikiActionChannel[]>; findPage(id: string): Promise<WikiPinPage[]>;}
export interface WikiLockRepository extends WikiPinRepository {findPage(id: string): Promise<WikiLockPage[]>; updateLock(id: string, update: WikiLockUpdate): Promise<{wikiPages: WikiLockResult[]}>;}
export interface FeaturedWikiRepository {findServer(serverName: string): Promise<Array<{serverName:string|null}>>;findPages(ids: string[]): Promise<Array<{id:string}>>;setFeaturedPages(serverName: string, ids:string[]):Promise<{serverConfigs:FeaturedWikiResult[]}>;}
export const WIKI_LOCK_RESULT = `{wikiPages {id title body slug channelUniqueName locked lockedAt lockReason lockedByUsername}}`;
export const FEATURED_WIKI_RESULT = `{serverConfigs {serverName featuredWikiPageIds}}`;
const CHANNEL = `query WikiActionChannel($where: ChannelWhere) {channels(where: $where) {uniqueName wikiEnabled}}`;
const PIN_PAGE = `query WikiPinPage($where: WikiPageWhere) {wikiPages(where: $where) {id Channel {uniqueName}}}`;
const LOCK_PAGE = `query WikiLockPage($where: WikiPageWhere) {wikiPages(where: $where) {id Channel {uniqueName} locked}}`;
const LOCK = `mutation SetWikiPageLock($where: WikiPageWhere, $update: WikiPageUpdateInput) {updateWikiPages(where: $where, update: $update) ${WIKI_LOCK_RESULT}}`;
const SERVER = `query FeaturedWikiServer($where: ServerConfigWhere) {serverConfigs(where: $where) {serverName}}`;
const PAGES = `query FeaturedWikiPages($where: WikiPageWhere) {wikiPages(where: $where) {id}}`;
const FEATURED = `mutation SetFeaturedWikiPageIds($where: ServerConfigWhere, $update: ServerConfigUpdateInput) {updateServerConfigs(where: $where, update: $update) ${FEATURED_WIKI_RESULT}}`;
async function findChannel(driver: Driver, uniqueName: string) {return (await executeGeneratedOperation<{channels:WikiActionChannel[]}>(driver,CHANNEL,{where:{uniqueName:{eq:uniqueName}}})).channels;}
export function createWikiPinRepository(driver: Driver): WikiPinRepository {
 return {findChannel:uniqueName=>findChannel(driver,uniqueName),async findPage(id){return (await executeGeneratedOperation<{wikiPages:WikiPinPage[]}>(driver,PIN_PAGE,{where:{id:{eq:id}}})).wikiPages;}};
}
export function createWikiLockRepository(driver: Driver): WikiLockRepository {
 return {findChannel:uniqueName=>findChannel(driver,uniqueName),async findPage(id){return (await executeGeneratedOperation<{wikiPages:WikiLockPage[]}>(driver,LOCK_PAGE,{where:{id:{eq:id}}})).wikiPages;},async updateLock(id,update){const setified=Object.fromEntries(Object.entries(update).map(([k,v])=>[k,{set:v}]));return (await executeGeneratedOperation<{updateWikiPages:{wikiPages:WikiLockResult[]}}>(driver,LOCK,{where:{id:{eq:id}},update:setified})).updateWikiPages;}};
}
export function createFeaturedWikiRepository(driver: Driver): FeaturedWikiRepository {
 return {async findServer(serverName){return (await executeGeneratedOperation<{serverConfigs:Array<{serverName:string|null}>}>(driver,SERVER,{where:{serverName:{eq:serverName}}})).serverConfigs;},async findPages(ids){return (await executeGeneratedOperation<{wikiPages:Array<{id:string}>}>(driver,PAGES,{where:{id:{in:ids}}})).wikiPages;},async setFeaturedPages(serverName,ids){return (await executeGeneratedOperation<{updateServerConfigs:{serverConfigs:FeaturedWikiResult[]}}>(driver,FEATURED,{where:{serverName:{eq:serverName}},update:{featuredWikiPageIds:{set:ids}}})).updateServerConfigs;}};
}

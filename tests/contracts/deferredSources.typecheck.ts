import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import type { OpaqueListSource, DelegatedActivitySource } from "../../customResolvers/contracts/deferredSources.js";
import createActivity from "../../customResolvers/mutations/addIssueActivityFeedItem.js";
import type { Driver } from "neo4j-driver";
type List = (parent: unknown, args: {limit:number}, context: GraphQLContext, info: GraphQLResolveInfo) => {id:string}[];
const opaque: OpaqueListSource<List> = () => [{unverified:true},undefined];
// Opaque items deliberately are not claimed to satisfy the generated entity.
// @ts-expect-error generated non-null list container cannot be absent
const missing: OpaqueListSource<List> = () => null;
// @ts-expect-error generated argument types are retained
const badArgs: OpaqueListSource<List> = (_parent,args:{limit:string}) => [];
// @ts-expect-error scalar fields cannot be labeled as list-source boundaries
const scalar: OpaqueListSource<() => number> = () => [];
// @ts-expect-error unrestricted JSON/any cannot be used to prove a list container
const json: OpaqueListSource<() => any> = () => [];
const nullable: OpaqueListSource<() => {id:string}[] | null> = () => null;
declare const driver: Driver;
const activity = createActivity({driver}) satisfies DelegatedActivitySource;
// @ts-expect-error a delegated payload requires the child source method
const absent: DelegatedActivitySource = () => ({});
// @ts-expect-error an eager array does not satisfy the delegated source-method boundary
const eager: DelegatedActivitySource = () => ({issues:[]});
// @ts-expect-error default field methods take three arguments, without a parent argument
const parentSlot: DelegatedActivitySource = () => ({issues:(_parent:unknown,_args:unknown,_context:GraphQLContext,_info:GraphQLResolveInfo)=>[]});
void [opaque,missing,badArgs,scalar,json,nullable,activity,absent,eager,parentSlot];

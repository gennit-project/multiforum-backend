import type {GraphQLResolveInfo} from 'graphql';
import {resolveUsersWithChildIdentity,userChildIdentityAtPath,generatedAuthorTypesAtPaths} from '../../middleware/userChildIdentityMiddleware.js';
declare const info:GraphQLResolveInfo;
declare const rawUsername:unknown;
const source={users:[{username:rawUsername}],count:1};
const root=resolveUsersWithChildIdentity(()=>source.users,null,{},null,info);
const exactRoot:Promise<typeof source.users>=root;
// @ts-expect-error metadata does not validate raw persisted usernames
const completedRoot:Promise<{username:string}[]>=root;
const nested=userChildIdentityAtPath(['users'])(async()=>source,null,{},null,info);
const exactNested:Promise<typeof source>=nested;
// @ts-expect-error metadata cannot invent other projected fields
const extraField:Promise<typeof source & {other:string}>=nested;
const nullable=generatedAuthorTypesAtPaths([{path:['users']}])(()=>Math.random()?source:null,null,{},null,info);
const exactNullable:Promise<typeof source|null>=nullable;
// @ts-expect-error source nullability must survive the adapter
const nonNull:Promise<typeof source>=nullable;
declare const unknownResult:unknown;
const opaque=userChildIdentityAtPath(['users'])(()=>unknownResult,null,{},null,info);
// @ts-expect-error unknown upstream results remain unknown
const invented:Promise<typeof source>=opaque;
const typedResolve=(_parent:{id:string},_args:{where:{id:string}},_context:{viewer:string},_info:GraphQLResolveInfo)=>source;
resolveUsersWithChildIdentity(typedResolve,{id:'source'},{where:{id:'source'}},{viewer:'actor'},info);
// @ts-expect-error resolver argument requirements must survive the adapter
resolveUsersWithChildIdentity(typedResolve,{id:'source'},{where:{wrong:'source'}},{viewer:'actor'},info);
void [exactRoot,completedRoot,exactNested,extraField,exactNullable,nonNull,opaque,invented];

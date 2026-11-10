import type {GraphQLResolveInfo} from 'graphql';
import {accountChildIdentity,rememberAccountChildIdentity} from './accountChildIdentity.js';
import {authorSourceType,rememberAuthorSourceType} from './authorSourceType.js';

type Path = readonly (string|number)[];
type Metadata = {path:Path;identity:ReturnType<typeof accountChildIdentity>;author:ReturnType<typeof authorSourceType>};
type Scope = {fieldName:string;rootInfo?:GraphQLResolveInfo;values:Map<string,Metadata>};
const scopes = new WeakMap<object,Scope>();
export type SourceMetadataRecorder = (path:Path,source:object)=>void;
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}

/** A fresh, application-owned delegation context scopes the private transfer.
 * No context property, response field, extra read or serialized identity is added.
 */
export async function withDelegatedSourceMetadata(context:Record<string,unknown>,fieldName:string,run:()=>unknown):Promise<unknown>{
 if(scopes.has(context))throw new Error('Delegated source metadata requires a fresh context');
 const scope:Scope={fieldName,values:new Map()};scopes.set(context,scope);
 try{
  const result:unknown=await run();
  for(const {path,identity,author} of scope.values.values()){
   let value:unknown=result;
   for(const key of path){
    if(typeof key==='number'&&Array.isArray(value)){const items:readonly unknown[]=value;value=items[key];}
    else if(typeof key==='string'&&object(value))value=value[key];
    else {value=undefined;break;}
   }
   if(!object(value))continue; // GraphQL may null a child or its ancestor on error.
   if(identity.found)rememberAccountChildIdentity(value,identity.value);
   if(author.found)rememberAuthorSourceType(value,author.value);
  }
  return result;
 }finally{scopes.delete(context);}
}

/** Called before the target root executes; nested GraphQL operations cannot
 * replace the captured root invocation or contribute metadata to its response paths.
 */
export function sourceMetadataRecorder(context:unknown,info:GraphQLResolveInfo):SourceMetadataRecorder|undefined{
 if(!object(context))return undefined;
 const scope=scopes.get(context);
 if(!scope||info.parentType.name!=='Query'||info.fieldName!==scope.fieldName||info.path.prev)return undefined;
 scope.rootInfo??=info;
 if(scope.rootInfo!==info)return undefined;
 return(path,source)=>{
  const identity=accountChildIdentity(source),author=authorSourceType(source);
  if(identity.found||author.found)scope.values.set(JSON.stringify(path),{path:[...path],identity,author});
 };
}

import {getNamedType,isObjectType,type GraphQLNamedType,type GraphQLResolveInfo,type SelectionSetNode} from "graphql";

/** Test-only drift guard for fixed object projections. Aliases are response keys;
 * duplicate selections merge. Conditional/abstract selections need an explicit
 * optional/union contract and are rejected rather than flattened unsoundly. */
export function staticResponsePaths(info: Pick<GraphQLResolveInfo,"fieldNodes"|"fragments"|"returnType">): string[] {
 const paths=new Set<string>();
 function walk(set:SelectionSetNode,type:GraphQLNamedType,prefix:string){
  if(!isObjectType(type))throw new Error(`Fixed object projection required at ${prefix||type.name}`);
  for(const selection of set.selections){
   if(selection.directives?.length)throw new Error('Conditional selections require an explicit optional response contract');
   if(selection.kind==='Field'){
    const key=selection.alias?.value??selection.name.value;
    const path=prefix?`${prefix}.${key}`:key;
    if(!selection.selectionSet){paths.add(path);continue;}
    const field=type.getFields()[selection.name.value];
    if(!field)throw new Error(`Unknown field ${type.name}.${selection.name.value}`);
    walk(selection.selectionSet,getNamedType(field.type),path);
   }else{
    const fragment=selection.kind==='FragmentSpread'?info.fragments[selection.name.value]:selection;
    if(!fragment)throw new Error('Missing fragment');
    if(fragment.directives?.length)throw new Error('Conditional fragment requires an explicit response contract');
    if(fragment.typeCondition&&fragment.typeCondition.name.value!==type.name)throw new Error('Abstract/narrowed fragments require a union response contract');
    walk(fragment.selectionSet,type,prefix);
   }
  }
 }
 for(const field of info.fieldNodes){
  if(field.directives?.length)throw new Error('Conditional root requires an explicit response contract');
  if(field.selectionSet)walk(field.selectionSet,getNamedType(info.returnType),'');
 }
 return [...paths].sort();
}
export function declaredResponsePaths(selection:Record<string,unknown>,prefix=''):string[]{
 return Object.entries(selection).flatMap(([key,value])=>{
  const path=prefix?`${prefix}.${key}`:key;
  if(value===true)return [path];
  if(value&&typeof value==='object'&&!Array.isArray(value))return declaredResponsePaths(Object.fromEntries(Object.entries(value)),path);
  throw new Error(`Invalid fixed selection at ${path}`);
 }).sort();
}

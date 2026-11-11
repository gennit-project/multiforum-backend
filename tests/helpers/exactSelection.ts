import assert from 'node:assert/strict';
import {parse,print,visit,type SelectionSetNode} from 'graphql';
// Exact fixed selection comparison retains explicit inline-union branches.
// It does not flatten branch-only fields into unconditional guarantees.
function render(selection:Record<string,unknown>):string {
 return `{${Object.entries(selection).map(([name,value])=>value===true?name:
  value&&typeof value==='object'&&!Array.isArray(value)?`${name}${render(Object.fromEntries(Object.entries(value)))}`:
  assert.fail(`Invalid declared selection at ${name}`)).join(' ')}}`;
}
export const canonicalSelection=(selection:SelectionSetNode)=>print(visit(selection,{SelectionSet(node){
 return {...node,selections:[...node.selections].sort((left,right)=>print(left).localeCompare(print(right)))};
}}));
export function declaredSelection(selection:Record<string,unknown>):string {
 const document=parse(`query ${render(selection)}`);
 const operation=document.definitions[0];assert.equal(operation.kind,'OperationDefinition');
 if(operation.kind!=='OperationDefinition')assert.fail('Expected operation');
 return canonicalSelection(operation.selectionSet);
}

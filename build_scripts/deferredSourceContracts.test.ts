import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
function returned(file:string){
 const src=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
 const fn=src.statements.find(n=>ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword));
 assert.ok(fn&&ts.isFunctionDeclaration(fn)&&fn.body);
 const result=fn.body.statements.find(ts.isReturnStatement)?.expression;
 assert.ok(result&&ts.isObjectLiteralExpression(result));return {src,result};
}
test("opaque list sources check actual generated registrations without promoting opaque items",()=>{
 const {src,result}=returned("customResolvers/typeResolvers.ts");const names:string[]=[];
 for(const type of result.properties){
  if(!ts.isPropertyAssignment(type)||!ts.isObjectLiteralExpression(type.initializer))continue;
  for(const field of type.initializer.properties){
   if(!ts.isPropertyAssignment(field))continue;
   const expression=field.initializer;
   if(expression.getText(src).includes('emptyArrayFallback(')||field.name.getText(src)==='superUpvotedByUsers'){
    assert.ok(ts.isSatisfiesExpression(expression));
    const typeName=type.name.getText(src),fieldName=field.name.getText(src);
    assert.equal(expression.type.getText(src),`OpaqueListSource<${typeName}Resolvers<GraphQLContext>["${fieldName}"]>`);
    names.push(`${typeName}.${fieldName}`);
   }
  }
 }
 assert.equal(names.length,23);
 const inventory=JSON.parse(readFileSync('docs/resolver-contract-inventory.json','utf8')) as {fields:{field:string;status:string}[]};
 for(const name of names)assert.equal(inventory.fields.find(r=>r.field===name)?.status,'deferred');
});
test("the actual activity mutation registration checks its delegated source method",()=>{
 const {src,result}=returned('customResolvers/mutationResolvers.ts');
 const field=result.properties.find(n=>ts.isPropertyAssignment(n)&&n.name.getText(src)==='addIssueActivityFeedItem');
 assert.ok(field&&ts.isPropertyAssignment(field)&&ts.isSatisfiesExpression(field.initializer));
 assert.equal(field.initializer.type.getText(src),'DelegatedActivitySource');
 assert.equal(field.initializer.expression.getText(src),'addIssueActivityFeedItem({ driver })');
});

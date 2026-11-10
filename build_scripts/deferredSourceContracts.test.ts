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
   if(expression.getText(src).includes('emptyArrayFallback(')){
    assert.ok(ts.isSatisfiesExpression(expression));
    const typeName=type.name.getText(src),fieldName=field.name.getText(src);
    assert.equal(expression.type.getText(src),`OpaqueListSource<${typeName}Resolvers<GraphQLContext>["${fieldName}"]>`);
    if (ts.isCallExpression(expression.expression) && expression.expression.expression.getText(src) === 'emptyArrayFallback') {
     const source = expression.expression.arguments[0];
     assert.ok(source && ts.isStringLiteral(source), `${typeName}.${fieldName}: expected an explicit source field`);
     assert.equal(source.text, fieldName, `${typeName}.${fieldName}: fallback reads a different field`);
    }
    names.push(`${typeName}.${fieldName}`);
   }
  }
 }
 assert.equal(names.length,18);
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

test('activity payload delegates through the generated query-argument boundary',()=>{
 const file='customResolvers/mutations/addIssueActivityFeedItem.ts';
 const src=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const calls:ts.CallExpression[]=[];
 function walk(node:ts.Node){if(ts.isCallExpression(node))calls.push(node);ts.forEachChild(node,walk);}
 walk(src);
 assert.equal(calls.filter(call=>call.expression.getText(src)==='delegateQueryField').length,1);
 assert.equal(calls.filter(call=>call.expression.getText(src)==='delegateToSchema').length,0);
});

test('fixed flair source checks the actual generated raw-selection signature without claiming scalar values',()=>{
 const {src,result}=returned('customResolvers/typeResolvers.ts');
 const parent=result.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(src)==='DiscussionChannelListItem');
 assert.ok(parent&&ts.isPropertyAssignment(parent)&&ts.isObjectLiteralExpression(parent.initializer));
 const field=parent.initializer.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(src)==='Flairs');
 assert.ok(field&&ts.isPropertyAssignment(field)&&ts.isSatisfiesExpression(field.initializer));
 assert.equal(field.initializer.expression.getText(src),'discussionListFlairs');
 assert.equal(field.initializer.type.getText(src),'DiscussionListFlairSource');
 const inventory=JSON.parse(readFileSync('docs/resolver-contract-inventory.json','utf8')) as {fields:{field:string;status:string}[]};
 assert.equal(inventory.fields.find(row=>row.field==='DiscussionChannelListItem.Flairs')?.status,'deferred');
});

test('scratchpad raw voter source is checked at registration and read inside the write transaction',()=>{
 const {src,result}=returned('customResolvers/typeResolvers.ts');
 const parent=result.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(src)==='ScratchpadEntry');
 assert.ok(parent&&ts.isPropertyAssignment(parent)&&ts.isObjectLiteralExpression(parent.initializer));
 const field=parent.initializer.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(src)==='superUpvotedByUsers');
 assert.ok(field&&ts.isPropertyAssignment(field)&&ts.isSatisfiesExpression(field.initializer));
 assert.equal(field.initializer.expression.getText(src),'scratchpadSuperVoters');
 assert.equal(field.initializer.type.getText(src),'ScratchpadSuperVoterSource');
 const mutation=readFileSync('customResolvers/mutations/createScratchpadEntry.ts','utf8');
 const call='await readScratchpadSuperVoters(tx, sourceType, sourceId)';
 assert.equal(mutation.split(call).length,2);
 assert.ok(mutation.indexOf(call)<mutation.indexOf('await tx.commit()'));
});

test('sitewide file registration checks its fixed raw projection',()=>{
 const {src,result}=returned('customResolvers/typeResolvers.ts');
 const parent=result.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(src)==='SiteWideDiscussionListItem');
 assert.ok(parent&&ts.isPropertyAssignment(parent)&&ts.isObjectLiteralExpression(parent.initializer));
 const field=parent.initializer.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(src)==='DownloadableFiles');
 assert.ok(field&&ts.isPropertyAssignment(field)&&ts.isSatisfiesExpression(field.initializer));
 assert.equal(field.initializer.expression.getText(src),'siteWideDownloadableFiles');
 assert.equal(field.initializer.type.getText(src),'SiteWideDownloadFileSource');
});

test('image usage root checks its entire explicit raw projection at registration',()=>{
 const {src,result}=returned('customResolvers/queryResolvers.ts');
 const field=result.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(src)==='getImageAlbumUsage');
 assert.ok(field&&ts.isPropertyAssignment(field)&&ts.isSatisfiesExpression(field.initializer));
 assert.equal(field.initializer.type.getText(src),'ImageUsageSourceResolver');
 const inventory=JSON.parse(readFileSync('docs/resolver-contract-inventory.json','utf8')) as {fields:{field:string;status:string}[]};
 assert.equal(inventory.fields.find(row=>row.field==='Query.getImageAlbumUsage')?.status,'deferred');
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("all three actual variant URL registrations enforce their explicit JSON domain",()=>{
  const source=ts.createSourceFile("typeResolvers.ts",readFileSync(new URL("../customResolvers/typeResolvers.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
  const builder=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="buildTypeResolvers");
  assert.ok(builder&&ts.isFunctionDeclaration(builder)&&builder.body);
  const returned=builder.body.statements.find(ts.isReturnStatement)?.expression;
  assert.ok(returned&&ts.isObjectLiteralExpression(returned));
  for(const type of ["User","Image","Channel"]){
    const object: ts.ObjectLiteralElementLike | undefined=returned.properties.find(node=>ts.isPropertyAssignment(node)&&node.name.getText(source)===type);
    assert.ok(object&&ts.isPropertyAssignment(object)&&ts.isObjectLiteralExpression(object.initializer));
    const field: ts.ObjectLiteralElementLike | undefined=object.initializer.properties.find(node=>ts.isPropertyAssignment(node)&&node.name.getText(source)==="variantUrls");
    assert.ok(field&&ts.isPropertyAssignment(field)&&ts.isSatisfiesExpression(field.initializer));
    assert.equal(field.initializer.type.getText(source),`VariantUrlsDomainResolver<${type}Resolvers<GraphQLContext>["variantUrls"]>`);
    assert.equal(field.initializer.expression.getText(source),`${type.toLowerCase()}VariantUrls`);
  }
});

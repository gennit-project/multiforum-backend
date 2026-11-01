import { readFileSync } from "node:fs";
import ts from "typescript";

/** Read only composition builders; never execute resolver factories or connect
 * to a database. Unknown composition forms fail closed rather than disappearing. */
export function resolverFields(file: string, prefix?: string, variableName?: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const builder = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword));
  if (!builder?.body) throw new Error(`No default builder: ${file}`);
  const variables = new Map<string, ts.Expression>();
  for (const statement of builder.body.statements) if (ts.isVariableStatement(statement)) {
    for (const decl of statement.declarationList.declarations) if (ts.isIdentifier(decl.name) && decl.initializer) variables.set(decl.name.text, decl.initializer);
  }
  function object(expression: ts.Expression): ts.ObjectLiteralExpression {
    if (ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) return object(expression.expression);
    if (ts.isIdentifier(expression) && variables.has(expression.text)) return object(variables.get(expression.text)!);
    if (!ts.isObjectLiteralExpression(expression)) throw new Error(`Unsupported composition in ${file}: ${expression.getText(source)}`);
    return expression;
  }
  function fields(expression: ts.Expression, parent?: string): string[] {
    return object(expression).properties.flatMap((property): string[] => {
      if (ts.isSpreadAssignment(property)) return fields(property.expression, parent);
      if (!property.name || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) throw new Error(`Unsupported field in ${file}`);
      const name = property.name.text;
      if (parent) return [`${parent}.${name}`];
      if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) return fields(property.initializer, name);
      return [name]; // scalar implementation
    });
  }
  const result = variableName ? variables.get(variableName) : builder.body.statements.find(ts.isReturnStatement)?.expression;
  if (!result) throw new Error(`No resolver map in ${file}`);
  return fields(result, prefix).sort();
}
export function allResolverFields(): string[] {
  return [...resolverFields("customResolvers/queryResolvers.ts", "Query"),
    ...resolverFields("customResolvers/mutationResolvers.ts", "Mutation"),
    ...resolverFields("customResolvers/typeResolvers.ts")].sort();
}

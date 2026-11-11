import ts from "typescript";
import { getNamedType, isInterfaceType, isListType, isNonNullType, isObjectType, type GraphQLSchema, type GraphQLOutputType } from "graphql";
export type SourceFinding = {
    path: string;
    kind: "opaque-object" | "open-map" | "non-array-source" | "non-object-source" | "delegated-source";
    schema: string;
    sourceType: string;
};
export type SourceException = SourceFinding & {
    reason: string;
    followUp: string;
};
/** Inspect the inferred actual composition, not hand-written resolver aliases.
 * This intentionally audits only declared source properties: missing/unselected
 * fields, scalar validity, unions and runtime selections are separate contracts.
 */
export function collectResolverSourceFindings(program: ts.Program, schema: GraphQLSchema, filename: string): SourceFinding[] {
    const checker = program.getTypeChecker(), file = program.getSourceFile(filename);
    if (!file)
        throw Error(`Missing resolver composition: ${filename}`);
    const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
    if (!fn || !ts.isFunctionDeclaration(fn))
        throw Error('Expected a default composition function');
    const location = fn;
    const signature = checker.getSignatureFromDeclaration(location);
    if (!signature)
        throw Error('Composition signature unavailable');
    const output = checker.getReturnTypeOfSignature(signature), resolvers = output.getProperty('resolvers');
    if (!resolvers)
        throw Error('Composition must expose its actual resolvers');
    const findingList: SourceFinding[] = [];
    function finding(source: ts.Type, output: GraphQLOutputType, path: string, kind: SourceFinding['kind']) {
        findingList.push({ path, kind, schema: getNamedType(output).name, sourceType: source.aliasSymbol?.name ?? checker.typeToString(source) });
    }
    function walk(source: ts.Type, output: GraphQLOutputType, path: string, seen: ReadonlyMap<ts.Type, ReadonlySet<string>>): void {
        if (isNonNullType(output))
            return walk(source, output.ofType, path, seen);
        const named = getNamedType(output);
        if (source.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
            if (isObjectType(named) || isInterfaceType(named))
                finding(source, output, path, 'opaque-object');
            return;
        }
        source = checker.getNonNullableType(source);
        if (source.flags & ts.TypeFlags.Never)
            return;
        if (source.isUnion()) {
            for (const member of source.types)
                walk(member, output, path, seen);
            return;
        }
        if (isListType(output)) {
            if (checker.isArrayType(source) || checker.isTupleType(source)) {
                const item = source.getNumberIndexType();
                if (!item)
                    throw Error(`Array item type unavailable at ${path}`);
                walk(item, output.ofType, path + '[]', seen);
            }
            else
                finding(source, output, path, source.getCallSignatures().length ? 'delegated-source' : 'non-array-source');
            return;
        }
        if (!isObjectType(named) && !isInterfaceType(named))
            return;
        if (seen.get(source)?.has(named.name))
            return;
        const next = new Map(seen);
        next.set(source, new Set([...(seen.get(source) ?? []), named.name]));
        if (source.getStringIndexType())
            finding(source, output, path, 'open-map');
        const callable = source.getCallSignatures()[0];
        if (callable) {
            walk(checker.getAwaitedType(checker.getReturnTypeOfSignature(callable)) ?? checker.getReturnTypeOfSignature(callable), output, path + '()', next);
            return;
        }
        if (!(source.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) {
            finding(source, output, path, 'non-object-source');
            return;
        }
        for (const property of source.getProperties()) {
            const field = named.getFields()[property.name];
            if (field)
                walk(checker.getTypeOfSymbolAtLocation(property, location), field.type, path + '.' + property.name, next);
        }
    }
    const map = checker.getTypeOfSymbolAtLocation(resolvers, fn);
    for (const parent of map.getProperties()) {
        const type = schema.getType(parent.name);
        if (!type || (!isObjectType(type) && !isInterfaceType(type)))
            continue;
        for (const field of checker.getTypeOfSymbolAtLocation(parent, fn).getProperties()) {
            const declared = type.getFields()[field.name];
            if (!declared)
                continue;
            const callable = checker.getTypeOfSymbolAtLocation(field, fn).getCallSignatures()[0];
            if (!callable)
                continue;
            const returned = checker.getReturnTypeOfSignature(callable);
            walk(checker.getAwaitedType(returned) ?? returned, declared.type, parent.name + '.' + field.name, new Map());
        }
    }
    return [...new Map(findingList.map(item => [JSON.stringify(item), item])).values()].sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind) || a.sourceType.localeCompare(b.sourceType));
}
export function checkSourceCensus(actual: readonly SourceFinding[], expected: readonly SourceException[]): void {
    const key = (x: SourceFinding) => JSON.stringify({ path: x.path, kind: x.kind, schema: x.schema, sourceType: x.sourceType });
    for (const item of expected)
        if (!item.reason?.trim() || !item.followUp?.trim())
            throw Error(`Unexplained source exception: ${item.path}`);
    const expectedKeys = new Set(expected.map(key)), actualKeys = new Set(actual.map(key));
    if (expectedKeys.size !== expected.length)
        throw Error('Duplicate source exceptions');
    const unreviewed = actual.filter(x => !expectedKeys.has(key(x))), stale = expected.filter(x => !actualKeys.has(key(x)));
    if (unreviewed.length || stale.length)
        throw Error(`Resolver source census drift: ${JSON.stringify({ unreviewed, stale }, null, 2)}`);
}

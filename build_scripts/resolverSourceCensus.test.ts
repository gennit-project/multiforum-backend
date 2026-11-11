import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { buildSchema } from 'graphql';
import { collectResolverSourceFindings, checkSourceCensus, type SourceFinding } from './resolverSourceCensus.js';
test('actual inferred nested/opaque/list producers are detected without treating raw scalars as objects', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'resolver-source-census-'));
    try {
        const filename = path.join(directory, 'composition.ts');
        writeFileSync(filename, `export default function(){return {resolvers:{Query:{
   known:()=>({id:'ok',child:{title:'ok'}} as {id:string}&{child:{title:string}}), raw:()=>undefined as unknown,
   nested:()=>({id:'ok',child:undefined as unknown}), list:()=>[] as unknown[],
   wrongList:()=>({id:'wrong'}), wrongObject:()=>42,
   indexed:()=>({id:'ok'} as Record<string,unknown>), scalar:()=>undefined as unknown,
   delegated:()=> (_args:unknown)=>undefined as unknown,
  }}}}`);
        const program = ts.createProgram([filename], { strict: true, target: ts.ScriptTarget.ES2018, noEmit: true });
        const schema = buildSchema('type Query{known:Item raw:Item nested:Item list:[Item] wrongList:[Item] wrongObject:Item indexed:Item scalar:String delegated:[Item]} type Item{id:ID child:Child} type Child{title:String}');
        const findings = collectResolverSourceFindings(program, schema, filename);
        assert.deepEqual(findings.map(x => [x.path, x.kind]), [
            ['Query.delegated', 'delegated-source'], ['Query.indexed', 'open-map'], ['Query.list[]', 'opaque-object'], ['Query.nested.child', 'opaque-object'], ['Query.raw', 'opaque-object'], ['Query.wrongList', 'non-array-source'], ['Query.wrongObject', 'non-object-source'],
        ]);
        const expected = findings.map(x => ({ ...x, reason: 'Fixture boundary', followUp: 'Fixture review' }));
        checkSourceCensus(findings, expected);
        assert.throws(() => checkSourceCensus(findings, expected.slice(1)), /unreviewed/);
        assert.throws(() => checkSourceCensus(findings.slice(1), expected), /stale/);
        assert.throws(() => checkSourceCensus(findings, [...expected, expected[0]]), /Duplicate/);
        assert.throws(() => checkSourceCensus(findings, [{ ...expected[0], reason: '' }]), /Unexplained/);
    }
    finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
test('empty known boundaries need no opaque-source exceptions', () => {
    const actual: SourceFinding[] = [];
    checkSourceCensus(actual, []);
});

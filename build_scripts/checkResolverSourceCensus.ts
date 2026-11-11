import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { buildPublicSchema } from './publicSchema.js';
import { collectResolverSourceFindings, checkSourceCensus, type SourceException } from './resolverSourceCensus.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error)
    throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
if (parsed.errors.length)
    throw Error(parsed.errors.map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')).join('\n'));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const findings = collectResolverSourceFindings(program, await buildPublicSchema(), path.join(root, 'customResolvers.ts'));
const manifest = JSON.parse(readFileSync(path.join(root, 'docs/resolver-source-exceptions.json'), 'utf8')) as {
    formatVersion: number;
    exceptions: SourceException[];
};
if (manifest.formatVersion !== 1 || !Array.isArray(manifest.exceptions))
    throw Error('Unsupported source census manifest');
checkSourceCensus(findings, manifest.exceptions);
console.log(`Resolver source census: ${findings.length} explicitly accounted source boundaries; no unreviewed or stale entries.`);

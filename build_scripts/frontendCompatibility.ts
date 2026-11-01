import { buildSchema, findBreakingChanges, findDangerousChanges, Kind, NoUnusedFragmentsRule, parse, specifiedRules, validate, type GraphQLSchema } from "graphql";
import { sha256 } from "./schemaContract.js";

export const frontendRepository = "gennit-project/multiforum-nuxt";
const backendRepository = "gennit-project/multiforum-backend";
const commit = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
export type Client = { revision: string; operationsSha256: string; documents: number; purpose: string };
export type OperationContract = {
  formatVersion: number; repository: string; lockfileSha256: string;
  pinnedSchema: { repository: string; revision: string; sha256: string };
  sources: { file: string; sha256: string }[];
  documents: { id: string; file: string; line: number; column: number; source: string; sha256: string }[];
};
export type SchemaManifest = {
  formatVersion: number; source: { repository: string; revision: string };
  lockfileSha256: string; dependencies: Record<string, string>;
  files: { "schema.graphql": { sha256: string; bytes: number } };
};
export function readSupportList(content: string): Client[] {
  const config = JSON.parse(content) as { formatVersion: number; repository: string; clients: Client[] };
  if (config.formatVersion !== 1 || config.repository !== frontendRepository || !Array.isArray(config.clients) || !config.clients.length) throw new Error("Supported frontend list must be nonempty and versioned");
  const seen = new Set<string>();
  for (const client of config.clients) {
    if (!commit.test(client.revision) || !hash.test(client.operationsSha256) || !Number.isSafeInteger(client.documents) || client.documents < 1 || !client.purpose || seen.has(client.revision)) throw new Error("Invalid or duplicate supported frontend pin");
    seen.add(client.revision);
  }
  return config.clients;
}
export function readOperations(content: string, client: Client): OperationContract {
  if (sha256(content) !== client.operationsSha256) throw new Error(`Frontend ${client.revision}: operations checksum mismatch`);
  const contract = JSON.parse(content) as OperationContract;
  if (contract.formatVersion !== 1 || contract.repository !== frontendRepository || !hash.test(contract.lockfileSha256) || contract.pinnedSchema?.repository !== backendRepository || !commit.test(contract.pinnedSchema?.revision) || !hash.test(contract.pinnedSchema?.sha256) || !Array.isArray(contract.sources) || !contract.sources.length || !Array.isArray(contract.documents) || contract.documents.length !== client.documents) throw new Error("Invalid frontend contract provenance or document count");
  const files = new Set<string>();
  for (const source of contract.sources) {
    if (typeof source.file !== "string" || source.file.startsWith("/") || source.file.split("/").includes("..") || !hash.test(source.sha256) || files.has(source.file)) throw new Error("Invalid frontend source provenance");
    files.add(source.file);
  }
  const ids = new Set<string>();
  for (const document of contract.documents) {
    if (typeof document.source !== "string" || sha256(document.source) !== document.sha256 || typeof document.id !== "string" || !document.id || ids.has(document.id) || !files.has(document.file) || !Number.isSafeInteger(document.line) || document.line < 1 || !Number.isSafeInteger(document.column) || document.column < 1) throw new Error(`Invalid or duplicate operation document: ${document.id}`);
    ids.add(document.id);
  }
  return contract;
}
export function readSchema(sdl: string, manifestText: string, revision: string) {
  const manifest = JSON.parse(manifestText) as SchemaManifest;
  if (!commit.test(revision) || manifest.formatVersion !== 1 || manifest.source?.repository !== backendRepository || manifest.source.revision !== revision || !hash.test(manifest.lockfileSha256) || manifest.files?.["schema.graphql"]?.sha256 !== sha256(sdl) || manifest.files["schema.graphql"].bytes !== Buffer.byteLength(sdl) || ["graphql", "@neo4j/graphql", "neo4j-driver"].some((name) => !manifest.dependencies?.[name])) throw new Error("Schema revision/checksum/provenance mismatch");
  return { schema: buildSchema(sdl), manifest };
}
export function compareSchemas(candidate: GraphQLSchema, baseline: GraphQLSchema, contract: OperationContract) {
  const diagnostics = contract.documents.flatMap((document) => {
    try {
      const ast = parse(document.source);
      const rules = ast.definitions.some((d) => d.kind === Kind.OPERATION_DEFINITION) ? specifiedRules : specifiedRules.filter((rule) => rule !== NoUnusedFragmentsRule);
      return validate(candidate, ast, rules).map((error) => ({ document: document.id, file: document.file, line: document.line, message: error.message }));
    } catch (error) {
      return [{ document: document.id, file: document.file, line: document.line, message: String(error) }];
    }
  });
  const breakingChanges = findBreakingChanges(baseline, candidate);
  const dangerousChanges = findDangerousChanges(baseline, candidate);
  return { compatible: !diagnostics.length && !breakingChanges.length && !dangerousChanges.length, documents: contract.documents.length, diagnostics, breakingChanges, dangerousChanges };
}

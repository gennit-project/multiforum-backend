/**
 * DB-free / server-free generation of both code-generated type files, using
 * plain @graphql-codegen (no @neo4j/graphql-ogm).
 *
 *   1. ogm_types.ts             — public-schema GraphQL types (typescript plugin)
 *                                 + a generic model map for test mocks.
 *   2. src/generated/graphql.ts — typescript + typescript-resolvers.
 *
 * Both are generated from an INTROSPECTION of the in-process Neo4jGraphQL
 * schema (no live Neo4j, no running server).
 */
import { Neo4jGraphQL } from "@neo4j/graphql";
import { generate as runCodegen } from "@graphql-codegen/cli";
import { introspectionFromSchema } from "graphql";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import typeDefs from "../typeDefs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const ogmTypesOut = path.join(projectRoot, "ogm_types.ts");
const introspectionOut = path.join(projectRoot, "schema.introspection.json");
const graphqlTypesOut = path.join(projectRoot, "src/generated/graphql.ts");

// A generic model surface for the OGM-free test mocks (modelStub + repository
// stubs). The former OGM `<Name>Model` types exposed per-model CRUD signatures;
// post-removal the mocks only need the shape, and the typed GraphQL inputs/
// outputs are imported directly from the generated types above.
const MODEL_MAP_APPENDIX = `
// ---- Test-mock model surface (not generated from the schema) ----
export type CrudModel = {
  find: (...args: any[]) => Promise<any[]>;
  create: (...args: any[]) => Promise<any>;
  update: (...args: any[]) => Promise<any>;
  delete: (...args: any[]) => Promise<any>;
  aggregate: (...args: any[]) => Promise<any>;
};
export type ChannelModel = CrudModel;
export type DiscussionModel = CrudModel;
export type DownloadableFileModel = CrudModel;
export type PluginModel = CrudModel;
export type PluginPipelineRunModel = CrudModel;
export type PluginPipelineCampaignModel = CrudModel;
export type PluginRunModel = CrudModel;
export type PluginVersionModel = CrudModel;
export type ServerConfigModel = CrudModel;
export type ServerSecretModel = CrudModel;
export type UserModel = CrudModel;
export type ModelMap = Record<string, CrudModel>;
`;

async function main() {
  console.log("Building schema + introspection (no DB) ->", introspectionOut);
  const neoSchema = new Neo4jGraphQL({
    typeDefs,
    features: {
      filters: { String: { MATCHES: true } },
      subscriptions: true,
    },
  });
  const schema = await neoSchema.getSchema();
  const introspection = introspectionFromSchema(schema);
  fs.writeFileSync(introspectionOut, JSON.stringify(introspection));

  console.log("Generating types ->", ogmTypesOut, "and", graphqlTypesOut);
  await runCodegen(
    {
      schema: introspectionOut,
      generates: {
        [ogmTypesOut]: {
          plugins: ["typescript"],
          config: { defaultScalarType: "any" },
        },
        [graphqlTypesOut]: {
          plugins: ["typescript", "typescript-resolvers"],
          config: { defaultScalarType: "any" },
        },
      },
    },
    true
  );

  fs.appendFileSync(ogmTypesOut, MODEL_MAP_APPENDIX);
  fs.rmSync(introspectionOut, { force: true });
  console.log("Done.");
}

main().catch((err) => {
  console.error("Type generation failed:", err);
  process.exit(1);
});

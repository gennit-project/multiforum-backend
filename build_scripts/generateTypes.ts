/**
 * DB-free / server-free generation of both code-generated type files.
 *
 *   1. ogm_types.ts             — Neo4j OGM model types (@neo4j/graphql-ogm `generate`)
 *   2. src/generated/graphql.ts — graphql-codegen typescript + typescript-resolvers
 *
 * Neither generator needs a live Neo4j or a running server:
 *   - OGM `generate()` only calls `ogm.init()` and reads `ogm.schema`; the driver
 *     is only used to resolve queries at runtime, never during type generation.
 *   - `Neo4jGraphQL.getSchema()` builds the executable schema in-process.
 *
 * graphql.ts is generated from an INTROSPECTION result (matching what the old
 * `schema: "http://localhost:4000"` HTTP path produced) rather than SDL, so the
 * output shape matches what the hand-written code was authored against.
 */
import { Neo4jGraphQL } from "@neo4j/graphql";
import pkg from "@neo4j/graphql-ogm";
import { generate as runCodegen } from "@graphql-codegen/cli";
import { introspectionFromSchema } from "graphql";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import typeDefs from "../typeDefs.js";

const { OGM } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const ogmTypesOut = path.join(projectRoot, "ogm_types.ts");
const introspectionOut = path.join(projectRoot, "schema.introspection.json");
const graphqlTypesOut = path.join(projectRoot, "src/generated/graphql.ts");

async function main() {
  // 1. OGM model types (no driver needed for generation).
  console.log("Generating OGM types ->", ogmTypesOut);
  const ogm = new OGM({ typeDefs });
  const { generate } = pkg;
  await generate({ ogm, outFile: ogmTypesOut });

  // 2. Build schema in-process (no DB), emit an introspection result.
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

  // 3. graphql-codegen from the introspection JSON (no running server).
  console.log("Generating GraphQL resolver types ->", graphqlTypesOut);
  await runCodegen(
    {
      schema: introspectionOut,
      generates: {
        [graphqlTypesOut]: {
          plugins: ["typescript", "typescript-resolvers"],
          // graphql-codegen v6 changed the default for unmapped custom scalars
          // (DateTime, JSON) from `any` to `unknown`. The hand-written code was
          // authored against `any`; restore that to avoid a wide refactor.
          config: { defaultScalarType: "any" },
        },
      },
    },
    true
  );

  fs.rmSync(introspectionOut, { force: true });
  console.log("Done.");
}

main().catch((err) => {
  console.error("Type generation failed:", err);
  process.exit(1);
});

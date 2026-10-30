/**
 * TEMP (frontend v7 migration): build the augmented v7 schema in-process (no DB)
 * and write the SDL + introspection JSON to the frontend scratchpad so frontend
 * operations can be validated and types regenerated. Safe to delete.
 */
import { buildPublicSchema } from "./publicSchema.js";
import { introspectionFromSchema, printSchema } from "graphql";
import fs from "fs";

const OUT_DIR = process.env.FE_SCHEMA_OUT_DIR as string;
if (!OUT_DIR) {
  console.error("Set FE_SCHEMA_OUT_DIR");
  process.exit(1);
}

async function main() {
  const schema = await buildPublicSchema();
  fs.writeFileSync(`${OUT_DIR}/v7.schema.graphql`, printSchema(schema));
  fs.writeFileSync(
    `${OUT_DIR}/v7.introspection.json`,
    JSON.stringify(introspectionFromSchema(schema))
  );
  console.log("wrote v7.schema.graphql + v7.introspection.json ->", OUT_DIR);
}

main().catch((err) => {
  console.error("dump failed:", err);
  process.exit(1);
});

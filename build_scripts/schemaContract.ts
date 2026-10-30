import { createHash } from "node:crypto";
import { printSchema, type GraphQLSchema } from "graphql";

export const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

export function createSchemaContract(
  schema: GraphQLSchema,
  revision: string,
  dependencies: Record<string, string>,
  lockfile: string,
) {
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error("Schema source revision must be a full Git commit SHA");
  }
  // Preserve schema definition order, including deprecated inputs. Fixed
  // sources and locked dependencies produce identical bytes; no timestamps.
  const sdl = `${printSchema(schema)}\n`;
  const manifest = {
    formatVersion: 1,
    source: { repository: "gennit-project/multiforum-backend", revision },
    dependencies,
    lockfileSha256: sha256(lockfile),
    files: {
      "schema.graphql": { sha256: sha256(sdl), bytes: Buffer.byteLength(sdl) },
    },
  };
  return { sdl, manifest: `${JSON.stringify(manifest, null, 2)}\n` };
}

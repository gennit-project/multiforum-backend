import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { allResolverFields } from "./resolverContractInventory.js";
import { checkedResolverFields } from "../customResolvers/contracts/registry.js";
import { votingMutationNames } from "../customResolvers/contracts/voting.js";
import { subscriptionMutationNames } from "../customResolvers/contracts/subscriptions.js";
import { reactionMutationNames } from "../customResolvers/contracts/reactions.js";

type Audit = { field: string; selectedPaths: string[]; residualPaths: string[]; evidence: unknown; reason: string; decision: string | null };
function evidencePaths(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(evidencePaths);
  if (value && typeof value === "object") return Object.values(value).flatMap(evidencePaths);
  return [];
}
test("campaign audit accounts for every remaining field and does not promote unexplained raw results", () => {
  const baseline = [...votingMutationNames, ...subscriptionMutationNames, ...reactionMutationNames].map(name => `Mutation.${name}`);
  const rows = readdirSync("docs/resolver-contract-audit").filter(file => file.endsWith(".json")).flatMap(file => {
    const audit = JSON.parse(readFileSync(`docs/resolver-contract-audit/${file}`, "utf8")) as { fields?: Audit[]; entries?: Audit[] };
    return audit.fields ?? audit.entries ?? [];
  });
  assert.equal(new Set(rows.map(row => row.field)).size, rows.length, "duplicate audit ownership");
  assert.deepEqual(rows.map(row => row.field).sort(), allResolverFields().filter(field => !baseline.includes(field)));
  for (const row of rows) {
    assert.ok(row.reason.trim(), `${row.field}: reason required`);
    assert.equal(row.selectedPaths.length > 0, checkedResolverFields.includes(row.field), `${row.field}: selected paths must match actual checked registration`);
    if (!checkedResolverFields.includes(row.field)) {
      assert.ok(row.residualPaths.length, `${row.field}: unresolved output must be named`);
      assert.ok(row.decision?.trim(), `${row.field}: next decision/work must be explicit`);
    }
    const paths = evidencePaths(row.evidence);
    assert.ok(paths.length, `${row.field}: evidence required`);
    for (const path of paths) assert.ok(existsSync(path.replace(/:\d+$/, "")), `${row.field}: missing evidence ${path}`);
  }
});

/**
 * Bring stored age-gate flags (`ageGateRestricted`) in line with their
 * reference definitions. Content is clear unless marked, so a missing flag
 * means clear. Dry run by default; pass --apply to write.
 *
 *   pnpm run age-gate:sweep              # report only (compiled; run `pnpm run build` first locally)
 *   pnpm run age-gate:sweep -- --apply   # mark / unmark as needed
 *   pnpm run age-gate:sweep:dev          # same, from TypeScript via ts-node (local only)
 *
 * On Heroku, ts-node is pruned with the dev dependencies, so use the
 * compiled script and pass the command as one quoted string (Heroku CLI 11
 * mangles unquoted multi-word commands):
 *
 *   heroku run -a topical-backend-dev -- 'pnpm run age-gate:sweep'
 *   heroku run -a topical-backend-dev -- 'pnpm run age-gate:sweep -- --apply'
 *
 * Run it as the backfill, before enabling the age gate on an instance, and
 * whenever a dry run reports mismatches. See
 * docs/age-gate-materialization-design.md.
 */
import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import typeDefinitions from "../typeDefs.js";
import { getAgeGateStatements } from "../services/ageGate/definitions.js";
import { sweepAgeGate } from "../services/ageGate/sweep.js";

dotenv.config();

const apply = process.argv.includes("--apply");
const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const user = process.env.NEO4J_USERNAME || process.env.NEO4J_USER || "neo4j";
const password = process.env.NEO4J_PASSWORD;

if (!password) {
  throw new Error("NEO4J_PASSWORD is required to sweep age-gate flags");
}

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

try {
  const results = await sweepAgeGate({
    driver,
    statements: getAgeGateStatements(typeDefinitions),
    apply,
  });

  console.log(apply ? "Age-gate sweep (applied):" : "Age-gate sweep (dry run):");
  for (const result of results) {
    console.log(
      `  ${result.type.padEnd(18)} to restrict: ${String(result.toRestrict).padStart(6)}` +
        `  to unrestrict: ${String(result.toUnrestrict).padStart(6)}` +
        (apply ? `  updated: ${result.applied}` : "")
    );
    if (result.toRestrict > 0) {
      // Content under marked content without the flag is visible to
      // restricted viewers: some write path failed to mark it.
      console.warn(
        `  ! ${result.type}: under marked content but not restricted (a write path missed marking it): ${result.toRestrictIds.join(", ")}`
      );
    }
  }
  if (!apply) {
    const pending = results.some((r) => r.toRestrict + r.toUnrestrict > 0);
    console.log(pending ? "Run with --apply to update." : "Everything is in line.");
  }
} finally {
  await driver.close();
}

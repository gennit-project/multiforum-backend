/**
 * Bring stored age-gate flags (`ageGateCleared`) in line with their reference
 * definitions. Dry run by default; pass --apply to write.
 *
 *   pnpm run age-gate:sweep              # report only
 *   pnpm run age-gate:sweep -- --apply   # clear / un-clear as needed
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
      `  ${result.type.padEnd(18)} to clear: ${String(result.toClear).padStart(6)}` +
        `  to un-clear: ${String(result.toUnclear).padStart(6)}` +
        (apply ? `  updated: ${result.applied}` : "")
    );
    if (result.toUnclear > 0) {
      // A cleared node that is sensitive by definition means some write path
      // did not un-clear it: restricted viewers could see it until now.
      console.warn(
        `  ! ${result.type}: cleared but sensitive (a write path missed an un-clear): ${result.unclearIds.join(", ")}`
      );
    }
  }
  if (!apply) {
    const pending = results.some((r) => r.toClear + r.toUnclear > 0);
    console.log(pending ? "Run with --apply to update." : "Everything is in line.");
  }
} finally {
  await driver.close();
}

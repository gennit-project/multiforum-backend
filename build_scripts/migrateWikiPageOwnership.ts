import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import {
  auditWikiPageOwnership,
  migrateWikiPageOwnership,
  type WikiPageOwnershipReport,
} from "../services/wikiPageOwnershipMigration.js";
import { neo4jDriverConfig } from "../services/neo4jDriverConfig.js";
import {
  installDefaultNeo4jDatabase,
  resolveNeo4jDatabase,
} from "../services/neo4jDatabase.js";

dotenv.config({ quiet: true });
const apply = process.argv.includes("--apply");
const password = process.env.NEO4J_PASSWORD;
if (!password) throw new Error("NEO4J_PASSWORD is required");

const driver = installDefaultNeo4jDatabase(
  neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(
      process.env.NEO4J_USERNAME || process.env.NEO4J_USER || "neo4j",
      password
    ),
    neo4jDriverConfig
  ),
  resolveNeo4jDatabase()
);

const summarize = (report: WikiPageOwnershipReport) => ({
  total: report.records.length,
  orphaned: report.orphaned.map(({ id }) => id),
  missingChannels: report.missingChannels.map(({ id, storedChannelUniqueName }) => ({
    id,
    storedChannelUniqueName,
  })),
  multiplyOwned: report.multiplyOwned,
  mismatched: report.mismatched,
  missingRouteIdentity: report.missingRouteIdentity.map(({ id }) => id),
  duplicateRoutes: report.duplicateRoutes,
});

try {
  await driver.verifyConnectivity();
  if (apply) {
    const report = await migrateWikiPageOwnership(driver);
    console.log(JSON.stringify({ ...summarize(report), linkedPages: report.linkedPages }, null, 2));
  } else {
    const report = await auditWikiPageOwnership(driver);
    console.log(JSON.stringify(summarize(report), null, 2));
    if (
      report.missingChannels.length || report.multiplyOwned.length ||
      report.mismatched.length || report.missingRouteIdentity.length ||
      report.duplicateRoutes.length
    ) process.exitCode = 1;
    else console.log("Dry run only. Re-run with --apply to create ownership relationships.");
  }
} finally {
  await driver.close();
}

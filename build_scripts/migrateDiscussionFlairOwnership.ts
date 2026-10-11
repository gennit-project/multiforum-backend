import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import {
  auditDiscussionFlairOwnership,
  migrateDiscussionFlairOwnership,
  type DiscussionFlairOwnershipReport,
} from "../services/discussionFlairOwnershipMigration.js";
import { neo4jDriverConfig } from "../services/neo4jDriverConfig.js";
import {
  installDefaultNeo4jDatabase,
  resolveNeo4jDatabase,
} from "../services/neo4jDatabase.js";

dotenv.config({ quiet: true });

const apply = process.argv.includes("--apply");
const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const username =
  process.env.NEO4J_USERNAME || process.env.NEO4J_USER || "neo4j";
const password = process.env.NEO4J_PASSWORD;

if (!password) {
  throw new Error("NEO4J_PASSWORD is required");
}

const driver = installDefaultNeo4jDatabase(
  neo4j.driver(uri, neo4j.auth.basic(username, password), neo4jDriverConfig),
  resolveNeo4jDatabase()
);

const summarize = (report: DiscussionFlairOwnershipReport) => ({
  total: report.records.length,
  orphaned: report.orphaned.map(({ id }) => id),
  multiplyOwned: report.multiplyOwned.map(({ id, ownerChannelUniqueNames }) => ({
    id,
    ownerChannelUniqueNames,
  })),
  mismatched: report.mismatched.map(
    ({ id, storedChannelUniqueName, ownerChannelUniqueNames }) => ({
      id,
      storedChannelUniqueName,
      ownerChannelUniqueNames,
    })
  ),
  storedPropertyCount: report.storedPropertyCount,
});

try {
  await driver.verifyConnectivity();
  if (!apply) {
    const report = await auditDiscussionFlairOwnership(driver);
    console.log(JSON.stringify(summarize(report), null, 2));
    if (report.orphaned.length > 0 || report.multiplyOwned.length > 0) {
      process.exitCode = 1;
    } else {
      console.log("Dry run only. Re-run with --apply to remove the legacy property.");
    }
  } else {
    const report = await migrateDiscussionFlairOwnership(driver);
    console.log(
      JSON.stringify(
        {
          ...summarize(report),
          removedStoredProperties: report.removedStoredProperties,
        },
        null,
        2
      )
    );
  }
} finally {
  await driver.close();
}

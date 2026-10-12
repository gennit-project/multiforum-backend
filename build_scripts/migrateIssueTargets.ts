import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import {
  auditIssueTargets,
  migrateIssueTargets,
  type IssueTargetMigrationReport,
} from "../services/issueTargetMigration.js";
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

const identity = (record: IssueTargetMigrationReport["records"][number]) => ({
  issueId: record.issueId,
  scalarField: record.scalarField,
  scalarValue: record.scalarValue,
  relationshipType: record.relationshipType,
  relationshipValues: record.relationshipValues,
  relationshipCount: record.relationshipCount,
  matchingTargetCount: record.matchingTargetCount,
});

const summarize = (report: IssueTargetMigrationReport) => ({
  issues: new Set(report.records.map((record) => record.issueId)).size,
  missingRelationships: report.missingRelationships.map(identity),
  missingTargets: report.missingTargets.map(identity),
  invalidRelationships: report.invalidRelationships.map(identity),
  ambiguousTargets: report.ambiguousTargets.map(identity),
});

try {
  await driver.verifyConnectivity();
  if (apply) {
    const report = await migrateIssueTargets(driver);
    console.log(JSON.stringify({
      ...summarize(report),
      linkedByRelationship: report.linkedByRelationship,
    }, null, 2));
  } else {
    const report = await auditIssueTargets(driver);
    console.log(JSON.stringify(summarize(report), null, 2));
    if (report.invalidRelationships.length || report.ambiguousTargets.length) {
      process.exitCode = 1;
    } else {
      console.log(
        "Dry run only. Re-run with --apply to backfill resolvable issue target relationships."
      );
    }
  }
} finally {
  await driver.close();
}

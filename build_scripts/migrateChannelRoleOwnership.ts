import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import {
  auditChannelRoleOwnership,
  migrateChannelRoleOwnership,
  type ChannelRoleOwnershipReport,
} from "../services/channelRoleOwnershipMigration.js";
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

const identity = (record: ChannelRoleOwnershipReport["records"][number]) => ({
  kind: record.kind,
  elementId: record.elementId,
  id: record.id,
  name: record.name,
  storedChannelUniqueName: record.storedChannelUniqueName,
  attachedChannelUniqueNames: record.attachedChannelUniqueNames,
  ownerChannelUniqueNames: record.ownerChannelUniqueNames,
  expectedChannelUniqueName: record.expectedChannelUniqueName,
});

const summarize = (report: ChannelRoleOwnershipReport) => ({
  total: report.records.length,
  ambiguousAttachments: report.ambiguousAttachments.map(identity),
  missingChannels: report.missingChannels.map(identity),
  invalidOwners: report.invalidOwners.map(identity),
  mismatchedIdentity: report.mismatchedIdentity.map(identity),
  missingIdentity: report.missingIdentity.map(identity),
  duplicateIdentities: report.duplicateIdentities,
  legacyGlobalNameConstraints: report.legacyGlobalNameConstraints,
});

try {
  await driver.verifyConnectivity();
  if (apply) {
    const report = await migrateChannelRoleOwnership(driver);
    console.log(JSON.stringify({
      ...summarize(report),
      linkedChannelRoles: report.linkedChannelRoles,
      linkedModChannelRoles: report.linkedModChannelRoles,
      droppedLegacyConstraints: report.droppedLegacyConstraints,
    }, null, 2));
  } else {
    const report = await auditChannelRoleOwnership(driver);
    console.log(JSON.stringify(summarize(report), null, 2));
    if (
      report.ambiguousAttachments.length || report.missingChannels.length ||
      report.invalidOwners.length || report.mismatchedIdentity.length ||
      report.missingIdentity.length || report.duplicateIdentities.length
    ) process.exitCode = 1;
    else console.log(
      "Dry run only. Re-run with --apply to create ownership relationships and replace global role-name constraints."
    );
  }
} finally {
  await driver.close();
}

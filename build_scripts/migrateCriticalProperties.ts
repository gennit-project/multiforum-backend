import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import {
  auditCriticalProperties,
  criticalPropertyConstraintNames,
  migrateCriticalPropertyConstraints,
} from "../services/criticalPropertyConstraints.js";
import { neo4jDriverConfig } from "../services/neo4jDriverConfig.js";
import {
  installDefaultNeo4jDatabase,
  resolveNeo4jDatabase,
} from "../services/neo4jDatabase.js";

dotenv.config({ quiet: true });

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

const getEdition = async () => {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(
      "CALL dbms.components() YIELD edition RETURN edition LIMIT 1"
    );
    return (result.records[0]?.get("edition") as string | undefined) ?? "unknown";
  } finally {
    await session.close();
  }
};

try {
  await driver.verifyConnectivity();
  const edition = await getEdition();
  const apply = process.argv.includes("--apply");
  if (!edition.toLowerCase().includes("enterprise")) {
    throw new Error(
      `Critical property constraints require Neo4j Enterprise/Aura; found ${edition}.`
    );
  }

  if (apply) {
    const result = await migrateCriticalPropertyConstraints(driver, edition);
    console.log(JSON.stringify({
      edition,
      repairedLegacyImageTimestamps: result.repairedLegacyImageTimestamps,
      constraintsVerified: result.provision.constraints.length,
      remainingViolations: result.after.violations,
    }, null, 2));
  } else {
    const audit = await auditCriticalProperties(driver);
    console.log(JSON.stringify({
      edition,
      requiredConstraints: criticalPropertyConstraintNames.length,
      repairableViolations: audit.repairableViolations,
      blockingViolations: audit.blockingViolations,
    }, null, 2));
    if (audit.blockingViolations.length > 0) process.exitCode = 1;
    console.log(
      "Dry run only. Re-run with --apply to repair known legacy Image timestamps and create constraints."
    );
  }
} finally {
  await driver.close();
}

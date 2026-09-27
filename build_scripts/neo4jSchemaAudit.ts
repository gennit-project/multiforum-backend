import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import { neo4jDriverConfig } from "../services/neo4jDriverConfig.js";
import {
  installDefaultNeo4jDatabase,
  resolveNeo4jDatabase,
} from "../services/neo4jDatabase.js";
import { runNeo4jSchemaAudit } from "../services/neo4jSchemaAudit.js";

dotenv.config({ quiet: true });

const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const username =
  process.env.NEO4J_USERNAME || process.env.NEO4J_USER || "neo4j";
const password = process.env.NEO4J_PASSWORD;

if (!password) throw new Error("NEO4J_PASSWORD is required");

const driver = installDefaultNeo4jDatabase(
  neo4j.driver(uri, neo4j.auth.basic(username, password), neo4jDriverConfig),
  resolveNeo4jDatabase()
);

try {
  await driver.verifyConnectivity();
  const report = await runNeo4jSchemaAudit(driver);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await driver.close();
}

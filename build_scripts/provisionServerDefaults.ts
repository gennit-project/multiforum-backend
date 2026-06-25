// Runnable entry point for provisioning a Multiforum server's default roles and
// config. Idempotent — safe to run on a fresh install or an existing instance.
//
//   NEO4J_PASSWORD=... SERVER_CONFIG_NAME="My Server" \
//     node --loader ts-node/esm build_scripts/provisionServerDefaults.ts
//
// Also backfills existing admins into SuperAdmins (isAdmin phase-out). See
// docs/isadmin-phaseout-design.md and seedData/.
//
// Loads .env first (like index.ts) so NEO4J_PASSWORD etc. are read from the
// project's .env when not already exported in the shell.
import "dotenv/config";
import neo4j from "neo4j-driver";
import { createOgmAndModels } from "../customResolvers/resolverDeps.js";
import { provisionServerDefaults } from "../seedData/provisionServerDefaults.js";

const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const user = process.env.NEO4J_USER || "neo4j";
const password = process.env.NEO4J_PASSWORD;
const serverName = process.env.SERVER_CONFIG_NAME;

if (!password) {
  throw new Error("NEO4J_PASSWORD is required to run provisioning");
}
if (!serverName) {
  throw new Error("SERVER_CONFIG_NAME is required to run provisioning");
}

const run = async () => {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password as string));
  const deps = createOgmAndModels(driver);
  await deps.ogm.init();

  try {
    const result = await provisionServerDefaults({
      ServerRole: deps.ServerRole,
      ModServerRole: deps.ModServerRole,
      ServerConfig: deps.ServerConfig,
      serverName: serverName as string,
      log: (message) => console.log(`[provision] ${message}`),
    });
    console.log("[provision] Done:", JSON.stringify(result, null, 2));
  } finally {
    await driver.close();
  }
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Provisioning failed", error);
    process.exit(1);
  });

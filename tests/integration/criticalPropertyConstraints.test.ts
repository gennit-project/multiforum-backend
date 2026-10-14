import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import neo4j, { type Driver, Neo4jError } from "neo4j-driver";
import {
  auditCriticalProperties,
  criticalPropertyConstraintNames,
  ensureCriticalPropertyConstraints,
  migrateCriticalPropertyConstraints,
  CriticalPropertyDataError,
} from "../../services/criticalPropertyConstraints.js";

let container: StartedNeo4jContainer;
let driver: Driver;

before(async () => {
  container = await new Neo4jContainer("neo4j:2025-enterprise")
    .withEnvironment({ NEO4J_ACCEPT_LICENSE_AGREEMENT: "yes" })
    .start();
  driver = neo4j.driver(
    container.getBoltUri(),
    neo4j.auth.basic(container.getUsername(), container.getPassword())
  );
  await driver.getServerInfo();
}, { timeout: 240_000 });

after(async () => {
  await driver?.close();
  await container?.stop();
});

const run = async (query: string, parameters = {}) => {
  const session = driver.session();
  try {
    return await session.run(query, parameters);
  } finally {
    await session.close();
  }
};

const isConstraintFailure = (error: unknown) =>
  error instanceof Neo4jError &&
  error.code === "Neo.ClientError.Schema.ConstraintValidationFailed";

test("migration audits, repairs, enforces, and idempotently verifies critical properties", { timeout: 240_000 }, async () => {
  await run(`
    CREATE (:User {username: 123})
    CREATE (:Image {id: 'legacy-image'})
  `);

  const initialAudit = await auditCriticalProperties(driver);
  assert.deepEqual(
    initialAudit.violations.map(({ label, property, missing, wrongType }) => ({
      label,
      property,
      missing,
      wrongType,
    })),
    [
      { label: "User", property: "username", missing: 0, wrongType: 1 },
      { label: "Image", property: "createdAt", missing: 1, wrongType: 0 },
    ]
  );
  await assert.rejects(
    migrateCriticalPropertyConstraints(driver, "enterprise"),
    CriticalPropertyDataError
  );

  await run("MATCH (user:User) SET user.username = 'legacy-user'");
  const migration = await migrateCriticalPropertyConstraints(driver, "enterprise");
  assert.equal(migration.repairedLegacyImageTimestamps, 1);
  assert.equal(migration.after.violations.length, 0);
  assert.equal(
    migration.provision.constraints.length,
    criticalPropertyConstraintNames.length
  );

  const repaired = await run(`
    MATCH (image:Image {id: 'legacy-image'})
    RETURN image.createdAt.epochMillis AS epochMillis,
           image.createdAtBackfillSource AS source
  `);
  assert.equal(repaired.records[0]?.get("epochMillis").toNumber(), 0);
  assert.equal(repaired.records[0]?.get("source"), "legacy-unknown");

  const constraints = await run(`
    SHOW CONSTRAINTS YIELD name, type
    WHERE name IN $names
    RETURN name, type
  `, { names: criticalPropertyConstraintNames });
  assert.equal(constraints.records.length, criticalPropertyConstraintNames.length);
  assert.deepEqual(
    new Set(constraints.records.map((record) => record.get("type"))),
    new Set(["NODE_PROPERTY_EXISTENCE", "NODE_PROPERTY_TYPE"])
  );

  await assert.rejects(
    run("CREATE (:Image {id: 'missing-created-at'})"),
    isConstraintFailure
  );
  await assert.rejects(
    run("CREATE (:Image {id: 42, createdAt: datetime()})"),
    isConstraintFailure
  );
  await run("CREATE (:Image {id: 'valid-image', createdAt: datetime()})");

  const secondProvision = await ensureCriticalPropertyConstraints(
    driver,
    "enterprise"
  );
  assert.equal(secondProvision.constraints.length, criticalPropertyConstraintNames.length);
});

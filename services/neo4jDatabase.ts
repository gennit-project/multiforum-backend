import type { Driver, Session, SessionConfig } from "neo4j-driver";

export const DEFAULT_NEO4J_DATABASE = "neo4j";

export function resolveNeo4jDatabase(
  value = process.env.NEO4J_DATABASE
): string {
  const database = value?.trim();
  return database || DEFAULT_NEO4J_DATABASE;
}

/**
 * Ensure every session names its target database. Without this, the driver
 * performs a home-database discovery round trip for each new session.
 * Existing access-mode and bookmark settings are preserved.
 */
export function installDefaultNeo4jDatabase(
  driver: Driver,
  database = resolveNeo4jDatabase()
): Driver {
  const originalSession = driver.session.bind(driver);

  driver.session = ((config?: SessionConfig): Session =>
    originalSession({
      ...config,
      database: config?.database ?? database,
    })) as Driver["session"];

  return driver;
}

import { GraphQLBoolean, GraphQLInt, GraphQLString } from "graphql";
import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type ServerAgeConfig = Partial<{
  accountAgeGateEnabled: boolean | null;
  minimumAccountAge: number | null;
  sensitiveContentAgeGateEnabled: boolean | null;
  minimumSensitiveContentAge: number | null;
}>;
export type ServerFeatureConfig = {
  enableDownloads?: boolean | null;
  enableEvents?: boolean | null;
};
export interface AgePolicyReader {
  findAgePolicyConfigs(serverName: string): Promise<ServerAgeConfig[]>;
}
export interface InstancePolicyRepository extends AgePolicyReader {
  findSetupConfigs(serverName?: string): Promise<ServerFeatureConfig[]>;
}

export const FIND_AGE_POLICY_CONFIGS = `
  MATCH (config:ServerConfig {serverName: $serverName})
  RETURN config { .accountAgeGateEnabled, .minimumAccountAge,
    .sensitiveContentAgeGateEnabled, .minimumSensitiveContentAge } AS config
`;
// Scoped by serverName in practice (a server reads its own config). The
// ORDER BY only matters for the unscoped fallback: without it, Neo4j returns
// multiple configs in an unspecified order and the caller's serverConfigs[0]
// would pick an arbitrary row. A stable sort keeps that fallback deterministic.
export const FIND_SETUP_CONFIGS = `
  MATCH (config:ServerConfig)
  WHERE $serverName IS NULL OR config.serverName = $serverName
  RETURN config { .serverName, .enableDownloads, .enableEvents } AS config
  ORDER BY config.serverName
`;

const boolean = (value: unknown): boolean | null =>
  value == null ? null : GraphQLBoolean.serialize(neo4j.isInt(value) ? value.toNumber() : value);
// Match GraphQL 5 numericalResolver before GraphQL Int serialization, including
// its legacy conversion of nonempty strings through the public driver utility.
const numericValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(numericValue);
  if (value && (typeof value === "number" || typeof value === "string" ||
    typeof value === "bigint" || neo4j.isInt(value))) {
    return neo4j.integer.toNumber(value);
  }
  return value;
};
const integer = (value: unknown): number | null =>
  value == null ? null : GraphQLInt.serialize(numericValue(value));

export function createInstancePolicyRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): InstancePolicyRepository {
  const read = async (query: string, serverName?: string): Promise<Record<string, unknown>[]> => {
    // Match the generated OGM find execution, including managed reads/bookmarks.
    const session = driver.session({
      database, defaultAccessMode: neo4j.session.READ,
      bookmarkManager: driver.executeQueryBookmarkManager,
    });
    try {
      const result = await session.executeRead(tx => tx.run(query, { serverName: serverName ?? null }));
      return result.records.map(record => record.get("config") as Record<string, unknown>);
    } finally {
      await session.close();
    }
  };
  return {
    async findAgePolicyConfigs(serverName) {
      return (await read(FIND_AGE_POLICY_CONFIGS, serverName)).map(config => ({
        accountAgeGateEnabled: boolean(config.accountAgeGateEnabled),
        minimumAccountAge: integer(config.minimumAccountAge),
        sensitiveContentAgeGateEnabled: boolean(config.sensitiveContentAgeGateEnabled),
        minimumSensitiveContentAge: integer(config.minimumSensitiveContentAge),
      }));
    },
    async findSetupConfigs(serverName) {
      return (await read(FIND_SETUP_CONFIGS, serverName)).map(config => {
        // The old selection included serverName even though the caller ignores it.
        if (config.serverName != null) GraphQLString.serialize(config.serverName);
        return {
          enableDownloads: boolean(config.enableDownloads),
          enableEvents: boolean(config.enableEvents),
        };
      });
    },
  };
}

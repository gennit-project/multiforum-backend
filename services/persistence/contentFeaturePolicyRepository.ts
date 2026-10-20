import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type ChannelContentFeaturePolicy = {
  found: boolean;
  uniqueName: string | null;
  eventsEnabled: boolean | null;
  feedbackEnabled: boolean | null;
  downloadsEnabled: boolean | null;
  imageUploadsEnabled: boolean | null;
  wikiEnabled: boolean | null;
  allowedFileTypes: string[];
};

export type ServerFileTypePolicy = {
  found: boolean;
  allowedFileTypes: string[];
};

export interface ContentFeaturePolicyRepository {
  findChannelPolicy(uniqueName: string): Promise<ChannelContentFeaturePolicy>;
  findServerFileTypePolicy(): Promise<ServerFileTypePolicy>;
}

export const FIND_CHANNEL_CONTENT_FEATURE_POLICY_QUERY = `
  MATCH (channel:Channel {uniqueName: $uniqueName})
  RETURN channel.uniqueName AS uniqueName,
         channel.eventsEnabled AS eventsEnabled,
         channel.feedbackEnabled AS feedbackEnabled,
         channel.downloadsEnabled AS downloadsEnabled,
         channel.imageUploadsEnabled AS imageUploadsEnabled,
         channel.wikiEnabled AS wikiEnabled,
         channel.allowedFileTypes AS allowedFileTypes
  LIMIT 1
`;

export const FIND_SERVER_FILE_TYPE_POLICY_QUERY = `
  MATCH (serverConfig:ServerConfig)
  RETURN serverConfig.allowedFileTypes AS allowedFileTypes
  LIMIT 1
`;

const normalizeBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const normalizeString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const normalizeAllowedFileTypes = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const missingChannelPolicy = (): ChannelContentFeaturePolicy => ({
  found: false,
  uniqueName: null,
  eventsEnabled: null,
  feedbackEnabled: null,
  downloadsEnabled: null,
  imageUploadsEnabled: null,
  wikiEnabled: null,
  allowedFileTypes: [],
});

export const createContentFeaturePolicyRepository = (
  driver: Driver,
  database = resolveNeo4jDatabase()
): ContentFeaturePolicyRepository => {
  const runSingleLookup = async <T>(
    query: string,
    parameters: Record<string, string>,
    missing: T,
    mapRecord: (record: { get(key: string): unknown }) => T
  ): Promise<T> => {
    // Policy reads stay leader-routed so request-scoped bookmark management
    // preserves read-your-own-writes behavior during mutations.
    const session = driver.session({
      database,
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      const result = await session.run(query, parameters);
      const record = result.records[0];
      return record ? mapRecord(record) : missing;
    } finally {
      await session.close();
    }
  };

  return {
    findChannelPolicy(uniqueName) {
      return runSingleLookup(
        FIND_CHANNEL_CONTENT_FEATURE_POLICY_QUERY,
        { uniqueName },
        missingChannelPolicy(),
        (record): ChannelContentFeaturePolicy => ({
          found: true,
          uniqueName: normalizeString(record.get("uniqueName")),
          eventsEnabled: normalizeBoolean(record.get("eventsEnabled")),
          feedbackEnabled: normalizeBoolean(record.get("feedbackEnabled")),
          downloadsEnabled: normalizeBoolean(record.get("downloadsEnabled")),
          imageUploadsEnabled: normalizeBoolean(
            record.get("imageUploadsEnabled")
          ),
          wikiEnabled: normalizeBoolean(record.get("wikiEnabled")),
          allowedFileTypes: normalizeAllowedFileTypes(
            record.get("allowedFileTypes")
          ),
        })
      );
    },

    findServerFileTypePolicy() {
      return runSingleLookup(
        FIND_SERVER_FILE_TYPE_POLICY_QUERY,
        {},
        { found: false, allowedFileTypes: [] },
        (record): ServerFileTypePolicy => ({
          found: true,
          allowedFileTypes: normalizeAllowedFileTypes(
            record.get("allowedFileTypes")
          ),
        })
      );
    },
  };
};

export const resolveContentFeaturePolicyRepository = (context: {
  contentFeaturePolicyRepository?: ContentFeaturePolicyRepository;
  driver: Driver;
}): ContentFeaturePolicyRepository =>
  context.contentFeaturePolicyRepository ??
  createContentFeaturePolicyRepository(context.driver);

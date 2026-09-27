import type { ManagedTransaction, Session } from "neo4j-driver";
import {
  DEFAULT_RANKING_SETTINGS,
  getCommentHotRankingParams,
  getDiscussionHotRankingParams,
  readRankingSettings,
  type RankingSettings,
} from "./rankingSettings.js";

export type StoredRankingSettings = {
  settings: RankingSettings;
  updatedAt: string | null;
  updatedBy: string | null;
};

export const RANKING_SETTINGS_CACHE_TTL_MS = 30_000;

type CacheEntry = {
  expiresAt: number;
  settings: Promise<StoredRankingSettings | null>;
};

const cache = new Map<string, CacheEntry>();

const readRecord = (
  record:
    | {
        get: (key: string) => unknown;
      }
    | undefined
): StoredRankingSettings | null => {
  if (!record) {
    return null;
  }

  const updatedAt = record.get("updatedAt");
  const updatedBy = record.get("updatedBy");

  return {
    settings: readRankingSettings(record.get("settingsJson")),
    updatedAt: updatedAt == null ? null : String(updatedAt),
    updatedBy: updatedBy == null ? null : String(updatedBy),
  };
};

export const findRankingSettings = async ({
  executor,
  serverName,
}: {
  executor: Session | ManagedTransaction;
  serverName: string;
}): Promise<StoredRankingSettings | null> => {
  const result = await executor.run(
    `
      MATCH (serverConfig:ServerConfig {serverName: $serverName})
      RETURN serverConfig.rankingSettingsJson AS settingsJson,
             serverConfig.rankingSettingsUpdatedAt AS updatedAt,
             serverConfig.rankingSettingsUpdatedBy AS updatedBy
    `,
    { serverName }
  );

  return readRecord(result.records[0]);
};

const findCachedRankingSettings = async ({
  executor,
  serverName,
  now = Date.now(),
}: {
  executor: Session | ManagedTransaction;
  serverName: string;
  now?: number;
}): Promise<StoredRankingSettings | null> => {
  const cached = cache.get(serverName);
  if (cached && cached.expiresAt > now) {
    return cached.settings;
  }

  // Cache the promise so simultaneous list requests share the same lookup.
  const settings = findRankingSettings({ executor, serverName });
  const current = {
    expiresAt: now + RANKING_SETTINGS_CACHE_TTL_MS,
    settings,
  };
  cache.set(serverName, current);

  try {
    return await settings;
  } catch (error) {
    // A transient database failure must not remain cached.
    if (cache.get(serverName) === current) cache.delete(serverName);
    throw error;
  }
};

export const invalidateRankingSettingsCache = (serverName?: string): void => {
  if (serverName) {
    cache.delete(serverName);
    return;
  }
  cache.clear();
};

export const getHotRankingQueryParams = async ({
  executor,
  profile,
  sortOption,
  serverName = process.env.SERVER_CONFIG_NAME,
}: {
  executor: Session | ManagedTransaction;
  profile: "discussion" | "comment";
  sortOption: string;
  serverName?: string;
}) => {
  let settings = DEFAULT_RANKING_SETTINGS;

  if (sortOption === "hot" && serverName) {
    const stored = await findCachedRankingSettings({ executor, serverName });
    settings = stored?.settings ?? DEFAULT_RANKING_SETTINGS;
  }

  return profile === "discussion"
    ? getDiscussionHotRankingParams(settings)
    : getCommentHotRankingParams(settings);
};

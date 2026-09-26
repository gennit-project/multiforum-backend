/**
 * Short-lived, in-process cache of the server's age policy for the
 * per-request sensitive-content check.
 *
 * `mayAccessSensitiveContent` runs on every GraphQL operation, and loading the
 * policy is an OGM ServerConfig query: a database round trip plus Cypher
 * planning, on every request, for settings that almost never change.
 *
 * Staleness is bounded two ways:
 *   - Any ServerConfig mutation handled by this process clears the cache
 *     (see sensitiveContentPolicyMiddleware), so with a single instance an
 *     admin's change applies to the very next request.
 *   - Entries expire after AGE_POLICY_CACHE_TTL_MS, which bounds how long
 *     other instances can serve the old policy.
 *
 * Only the per-request access check uses this. Account creation, birthday
 * updates and the policy query still read the policy fresh.
 */

import {
  loadAgePolicy,
  type AgePolicy,
  type ServerConfigReader,
} from "./agePolicy.js";

export const AGE_POLICY_CACHE_TTL_MS = 30_000;

type CacheEntry = {
  serverName: string | undefined;
  expiresAt: number;
  policy: Promise<AgePolicy>;
};

let entry: CacheEntry | null = null;

type LoadCachedAgePolicyParams = {
  ServerConfig: ServerConfigReader;
  serverName?: string;
  now?: number;
};

export async function loadCachedAgePolicy({
  ServerConfig,
  serverName = process.env.SERVER_CONFIG_NAME,
  now = Date.now(),
}: LoadCachedAgePolicyParams): Promise<AgePolicy> {
  if (entry && entry.serverName === serverName && entry.expiresAt > now) {
    return entry.policy;
  }

  // Cache the promise so concurrent requests share one load.
  const policy = loadAgePolicy(ServerConfig, serverName);
  const current: CacheEntry = {
    serverName,
    expiresAt: now + AGE_POLICY_CACHE_TTL_MS,
    policy,
  };
  entry = current;

  try {
    return await policy;
  } catch (error) {
    // Never cache a failure; the next request retries.
    if (entry === current) entry = null;
    throw error;
  }
}

export function invalidateAgePolicyCache(): void {
  entry = null;
}

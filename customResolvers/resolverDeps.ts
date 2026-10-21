import { createInstancePolicyRepository } from "../services/persistence/instancePolicyRepository.js";
// Shared dependency bag for the custom resolver builders.
//
// customResolvers.ts used to create the OGM + every model and wire ~140
// resolvers inline in one ~740-line file. The driver-backed repositories now
// live here and are shared by the type/query/mutation resolver builders, each
// of which receives the same `ResolverDeps` object and destructures what it
// needs.
import type { Driver } from "neo4j-driver";

export function createOgmAndModels(driver: Driver) {
  return {
    instancePolicyRepository: createInstancePolicyRepository(driver),
    driver,
  };
}

export type ResolverDeps = ReturnType<typeof createOgmAndModels>;

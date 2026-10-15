import pkg from "@neo4j/graphql-ogm";
import type { Driver } from "neo4j-driver";
import type { ModelMap } from "../../ogm_types.js";
import typeDefs from "../../typeDefs.js";
import { createRepositoryProvider } from "./repository.js";

const { OGM } = pkg;

/**
 * Temporary adapter around the discontinued OGM. This is the only runtime
 * module allowed to construct or import it; callers receive application-owned
 * repository contracts so domains can be migrated independently.
 */
export function createOgmPersistence(driver: Driver) {
  const ogm = new OGM<ModelMap>({ typeDefs, driver });
  const models = {
    model<Name extends keyof ModelMap>(name: Name): ModelMap[Name] {
      return ogm.model(name) as ModelMap[Name];
    },
  };
  return {
    ogm,
    repositories: createRepositoryProvider<ModelMap>(models),
  };
}

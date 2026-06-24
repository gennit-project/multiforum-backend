// Composition root for the custom GraphQL resolvers.
//
// This used to be a ~740-line file that created the OGM + every model and wired
// ~140 resolvers inline. The OGM/model setup now lives in
// customResolvers/resolverDeps.ts and the wiring is split across the
// type/query/mutation resolver builders below. The exported factory signature
// is unchanged: getCustomResolvers(driver) => { resolvers, ogm }.
import type { Driver } from "neo4j-driver";
import { createOgmAndModels } from "./customResolvers/resolverDeps.js";
import buildTypeResolvers from "./customResolvers/typeResolvers.js";
import buildQueryResolvers from "./customResolvers/queryResolvers.js";
import buildMutationResolvers from "./customResolvers/mutationResolvers.js";

export default function (driver: Driver) {
  const deps = createOgmAndModels(driver);

  const resolvers = {
    ...buildTypeResolvers(deps),
    Query: buildQueryResolvers(deps),
    Mutation: buildMutationResolvers(deps),
  };

  return {
    resolvers,
    ogm: deps.ogm,
  };
}

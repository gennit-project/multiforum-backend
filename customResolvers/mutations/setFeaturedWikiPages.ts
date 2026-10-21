import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import { createFeaturedWikiRepository, type FeaturedWikiRepository } from "../../services/persistence/wikiActionRepository.js";

type Deps = {
  driver: Driver;
  repository?: FeaturedWikiRepository;
};

type Args = {
  serverName: string;
  wikiPageIds: string[];
};

const validateArgs = ({ serverName, wikiPageIds }: Args) => {
  if (!serverName) {
    throw new GraphQLError("A server name is required.");
  }

  const uniqueIds = new Set(wikiPageIds);
  if (uniqueIds.size !== wikiPageIds.length) {
    throw new GraphQLError("Featured wiki pages cannot contain duplicates.");
  }
};

export const setFeaturedWikiPages = ({ driver, repository: injectedRepository }: Deps) => {
  const repository = injectedRepository ?? createFeaturedWikiRepository(driver);
  return async (_parent: unknown, args: Args) => {
    validateArgs(args);

    const serverConfigs = await repository.findServer(args.serverName);

    if (!serverConfigs.length) {
      throw new GraphQLError("Server configuration not found.");
    }

    if (args.wikiPageIds.length > 0) {
      const wikiPages = await repository.findPages(args.wikiPageIds);
      const foundIds = new Set(wikiPages.map((page) => page.id).filter(Boolean));
      const missingIds = args.wikiPageIds.filter((id) => !foundIds.has(id));

      if (missingIds.length) {
        throw new GraphQLError(
          `Featured wiki page IDs were not found: ${missingIds.join(", ")}.`
        );
      }
    }

    const result = await repository.setFeaturedPages(args.serverName, args.wikiPageIds);

    const serverConfig = result.serverConfigs[0];
    if (!serverConfig) {
      throw new GraphQLError("Server configuration could not be updated.");
    }

    return serverConfig;
  };
};

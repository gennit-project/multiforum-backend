import { GraphQLError } from "graphql";
import type { ServerConfigModel, WikiPageModel } from "../../ogm_types.js";

type Deps = {
  ServerConfig: ServerConfigModel;
  WikiPage: WikiPageModel;
};

type Args = {
  serverName: string;
  wikiPageIds: string[];
};

type WikiPageLookup = {
  id?: string | null;
};

const returnedServerConfigSelectionSet = `{
  serverConfigs {
    serverName
    featuredWikiPageIds
  }
}`;

const validateArgs = ({ serverName, wikiPageIds }: Args) => {
  if (!serverName) {
    throw new GraphQLError("A server name is required.");
  }

  const uniqueIds = new Set(wikiPageIds);
  if (uniqueIds.size !== wikiPageIds.length) {
    throw new GraphQLError("Featured wiki pages cannot contain duplicates.");
  }
};

export const setFeaturedWikiPages = ({ ServerConfig, WikiPage }: Deps) => {
  return async (_parent: unknown, args: Args) => {
    validateArgs(args);

    const serverConfigs = await ServerConfig.find({
      where: { serverName: args.serverName },
      selectionSet: `{
        serverName
      }`,
    });

    if (!serverConfigs.length) {
      throw new GraphQLError("Server configuration not found.");
    }

    if (args.wikiPageIds.length > 0) {
      const wikiPages = (await WikiPage.find({
        where: { id_IN: args.wikiPageIds },
        selectionSet: `{
          id
        }`,
      })) as WikiPageLookup[];
      const foundIds = new Set(wikiPages.map((page) => page.id).filter(Boolean));
      const missingIds = args.wikiPageIds.filter((id) => !foundIds.has(id));

      if (missingIds.length) {
        throw new GraphQLError(
          `Featured wiki page IDs were not found: ${missingIds.join(", ")}.`
        );
      }
    }

    const result = await ServerConfig.update({
      where: { serverName: args.serverName },
      update: {
        featuredWikiPageIds: args.wikiPageIds,
      } as never,
      selectionSet: returnedServerConfigSelectionSet,
    });

    const serverConfig = result.serverConfigs[0];
    if (!serverConfig) {
      throw new GraphQLError("Server configuration could not be updated.");
    }

    return serverConfig;
  };
};

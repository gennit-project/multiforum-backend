import test from "node:test";
import assert from "node:assert/strict";
import { setFeaturedWikiPages } from "./setFeaturedWikiPages.js";

type FindArgs = {
  where?: Record<string, unknown>;
  selectionSet?: string;
};

type UpdateArgs = {
  where: Record<string, unknown>;
  update: Record<string, unknown>;
  selectionSet?: string;
};

const buildModels = ({
  serverConfig = { serverName: "test-server" },
  wikiPages = [{ id: "w1" }, { id: "w2" }],
}: {
  serverConfig?: Record<string, unknown> | null;
  wikiPages?: Array<Record<string, unknown>>;
} = {}) => {
  const calls = {
    updates: [] as UpdateArgs[],
  };

  return {
    calls,
    ServerConfig: {
      find: async (_args: FindArgs) => (serverConfig ? [serverConfig] : []),
      update: async (args: UpdateArgs) => {
        calls.updates.push(args);
        return {
          serverConfigs: [
            {
              ...serverConfig,
              ...args.update,
            },
          ],
        };
      },
    },
    WikiPage: {
      find: async ({ where }: FindArgs) => {
        const ids = (where?.id_IN || []) as string[];
        return wikiPages.filter((page) => ids.includes(page.id as string));
      },
    },
  };
};

test("setFeaturedWikiPages validates pages and stores ordered IDs", async () => {
  const models = buildModels();
  const resolver = setFeaturedWikiPages({
    ServerConfig: models.ServerConfig as never,
    WikiPage: models.WikiPage as never,
  });

  const result = await resolver(null, {
    serverName: "test-server",
    wikiPageIds: ["w2", "w1"],
  });

  assert.deepEqual(
    {
      result,
      update: models.calls.updates[0].update,
    },
    {
      result: {
        serverName: "test-server",
        featuredWikiPageIds: ["w2", "w1"],
      },
      update: {
        featuredWikiPageIds: ["w2", "w1"],
      },
    }
  );
});

test("setFeaturedWikiPages rejects duplicate IDs", async () => {
  const models = buildModels();
  const resolver = setFeaturedWikiPages({
    ServerConfig: models.ServerConfig as never,
    WikiPage: models.WikiPage as never,
  });

  await assert.rejects(
    () =>
      resolver(null, {
        serverName: "test-server",
        wikiPageIds: ["w1", "w1"],
      }),
    /duplicates/
  );
  assert.equal(models.calls.updates.length, 0);
});

test("setFeaturedWikiPages rejects missing wiki pages", async () => {
  const models = buildModels({ wikiPages: [{ id: "w1" }] });
  const resolver = setFeaturedWikiPages({
    ServerConfig: models.ServerConfig as never,
    WikiPage: models.WikiPage as never,
  });

  await assert.rejects(
    () =>
      resolver(null, {
        serverName: "test-server",
        wikiPageIds: ["w1", "missing"],
      }),
    /missing/
  );
  assert.equal(models.calls.updates.length, 0);
});

test("setFeaturedWikiPages allows clearing the featured page list", async () => {
  const models = buildModels();
  const resolver = setFeaturedWikiPages({
    ServerConfig: models.ServerConfig as never,
    WikiPage: models.WikiPage as never,
  });

  const result = await resolver(null, {
    serverName: "test-server",
    wikiPageIds: [],
  });

  assert.deepEqual(result.featuredWikiPageIds, []);
});

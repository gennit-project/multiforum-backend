import type { Driver } from "neo4j-driver";
import type { WikiPageWhere } from "../../src/generated/graphql.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type WikiGuardSnapshot = {
  id?: string | null;
  Channel?: { uniqueName?: string | null } | null;
  locked?: boolean | null;
  OriginalAuthor?: { username?: string | null } | null;
  ChildPages?: Array<{ id?: string | null }> | null;
};

type WikiGuardFilter = WikiPageWhere | Record<string, unknown> | null | undefined;
export interface WikiGuardRepository {
  findPermissionTargets(where: WikiGuardFilter): Promise<WikiGuardSnapshot[]>;
  findChildCreationOwners(where: WikiGuardFilter): Promise<Array<Pick<WikiGuardSnapshot, "Channel">>>;
}

// Fixed selections intentionally differ: ownership checks must not start
// validating unrelated lock/author/child fields. Preserve the full generated
// filter language and its existing default limits through the shared schema.
const WIKI_PERMISSION_TARGETS = `query WikiPermissionTargets($where: WikiPageWhere) {
  wikiPages(where: $where) {
    id
    Channel { uniqueName }
    locked
    OriginalAuthor { username }
    ChildPages { id }
  }
}`;
const WIKI_CHILD_CREATION_OWNERS = `query WikiChildCreationOwners($where: WikiPageWhere) {
  wikiPages(where: $where) { Channel { uniqueName } }
}`;

export function createWikiGuardRepository(driver: Driver): WikiGuardRepository {
  return {
    async findPermissionTargets(where) {
      const result = await executeGeneratedOperation<{ wikiPages: WikiGuardSnapshot[] }>(
        driver, WIKI_PERMISSION_TARGETS, { where }
      );
      return result.wikiPages;
    },
    async findChildCreationOwners(where) {
      const result = await executeGeneratedOperation<{ wikiPages: Array<Pick<WikiGuardSnapshot, "Channel">> }>(
        driver, WIKI_CHILD_CREATION_OWNERS, { where }
      );
      return result.wikiPages;
    },
  };
}

export function resolveWikiGuardRepository(context: {
  driver: Driver;
  wikiGuardRepository?: WikiGuardRepository;
}): WikiGuardRepository {
  return context.wikiGuardRepository ?? createWikiGuardRepository(context.driver);
}

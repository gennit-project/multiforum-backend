import { AsyncLocalStorage } from "node:async_hooks";
import neo4j, {
  type BookmarkManager,
  type Driver,
  type QueryConfig,
  type Session,
  type SessionConfig,
} from "neo4j-driver";

const bookmarkStorage = new AsyncLocalStorage<BookmarkManager>();

/**
 * Run one HTTP request with an isolated bookmark manager. Sessions created
 * during the request share causal state; concurrent requests never do.
 */
export function runWithRequestBookmarks<T>(fn: () => T): T {
  return bookmarkStorage.run(neo4j.bookmarkManager(), fn);
}

/** Exposed for diagnostics and focused tests; undefined outside HTTP requests. */
export function getRequestBookmarkManager(): BookmarkManager | undefined {
  return bookmarkStorage.getStore();
}

/**
 * Add request bookmark propagation to a shared Neo4j driver.
 *
 * The application and @neo4j/graphql both retain the shared driver, so the
 * wrapper resolves the current manager when each session/query is created.
 * Explicit managers supplied inside a request are replaced deliberately: one
 * manager must observe every successful write before a dependent routed read.
 */
export function installRequestScopedBookmarks(driver: Driver): Driver {
  const originalSession = driver.session.bind(driver);
  const originalExecuteQuery = driver.executeQuery.bind(driver);

  driver.session = ((config?: SessionConfig): Session => {
    const bookmarkManager = bookmarkStorage.getStore();
    return originalSession(
      bookmarkManager ? { ...config, bookmarkManager } : config
    );
  }) as Driver["session"];

  driver.executeQuery = ((
    query: Parameters<Driver["executeQuery"]>[0],
    parameters?: Parameters<Driver["executeQuery"]>[1],
    config?: QueryConfig
  ) => {
    const bookmarkManager = bookmarkStorage.getStore();
    return originalExecuteQuery(
      query,
      parameters,
      bookmarkManager ? { ...config, bookmarkManager } : config
    );
  }) as Driver["executeQuery"];

  return driver;
}

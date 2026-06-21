// Factory for a fake Neo4j driver.
//
// Resolvers call `driver.session(config).run(query, params)` then `.close()`.
// Tests need to (a) route a Cypher query to canned rows by matching a substring
// or regex, and (b) assert on how the driver was used. This factory provides
// both: pass `routes`, read `calls`.

import { makeResult, type Row } from "./neo4j.js";

export type RunArgs = [query: string, params: Record<string, unknown>];

export interface QueryRoute {
  // Substring (matched with `includes`) or RegExp tested against the query.
  match: string | RegExp;
  // Rows to return for a matching query, or a function of (query, params).
  rows?: Row[] | ((query: string, params: Record<string, unknown>) => Row[]);
}

export interface DriverOptions {
  routes?: QueryRoute[];
  // What to do when no route matches a query. "empty" returns no rows (the
  // permissive default); "throw" surfaces the unexpected query — useful when a
  // test wants to assert exactly which queries run.
  onUnmatched?: "empty" | "throw";
}

export interface DriverCalls {
  run: RunArgs[];
  sessions: number;
  closes: number;
  sessionConfig: unknown[];
}

export function makeDriver(options: DriverOptions = {}): {
  driver: { session: (config?: unknown) => unknown };
  calls: DriverCalls;
} {
  const { routes = [], onUnmatched = "empty" } = options;
  const calls: DriverCalls = {
    run: [],
    sessions: 0,
    closes: 0,
    sessionConfig: [],
  };

  const driver = {
    session: (config?: unknown) => {
      calls.sessions += 1;
      calls.sessionConfig.push(config);
      return {
        run: async (query: string, params: Record<string, unknown> = {}) => {
          calls.run.push([query, params]);
          for (const route of routes) {
            const matched =
              typeof route.match === "string"
                ? query.includes(route.match)
                : route.match.test(query);
            if (matched) {
              const rows =
                typeof route.rows === "function"
                  ? route.rows(query, params)
                  : route.rows ?? [];
              return makeResult(rows);
            }
          }
          if (onUnmatched === "throw") {
            throw new Error(`Unexpected query: ${query}`);
          }
          return makeResult([]);
        },
        close: async () => {
          calls.closes += 1;
        },
      };
    },
  };

  return { driver, calls };
}

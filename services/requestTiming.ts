/**
 * Per-request latency instrumentation.
 *
 * Answers "where did this request's time go?" by splitting each GraphQL
 * operation into:
 *
 *   - queue: HTTP arrival -> Apollo starts the request (body parsing, and any
 *            time the event loop was too busy to pick the request up)
 *   - parse / validate / execute: Apollo's phases
 *   - db: time spent inside Neo4j calls made on behalf of this request, and how
 *         many there were. Calls can overlap, so db is a sum, not wall time.
 *
 * Execute time minus db time approximates CPU spent in resolvers and the
 * graphql-middleware stack. The totals go to one structured log line per
 * operation and to a `Server-Timing` response header, which browser dev tools
 * show on the request.
 *
 * A separate periodic log reports event-loop delay and utilization, which
 * shows whether slow requests coincide with the process being CPU-bound.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { ApolloServerPlugin } from "@apollo/server";
import type { Driver, Session } from "neo4j-driver";
import { logger } from "../logger.js";

export type RequestTiming = {
  arrivedAt: number;
  dbMs: number;
  dbCalls: number;
};

const timingStorage = new AsyncLocalStorage<RequestTiming>();

const round = (ms: number): number => Math.round(ms * 10) / 10;

/**
 * Run `fn` with a fresh timing record bound to the request's async lifetime.
 * Called by the HTTP middleware as early as possible so queue time is counted.
 */
export function runWithRequestTiming<T>(fn: () => T): T {
  return timingStorage.run(
    { arrivedAt: performance.now(), dbMs: 0, dbCalls: 0 },
    fn
  );
}

export function getRequestTiming(): RequestTiming | undefined {
  return timingStorage.getStore();
}

/**
 * Time a promise-returning database call and charge it to the current request.
 * Calls made outside a request (background services) are not recorded.
 */
async function timeDbCall<T>(call: () => Promise<T>): Promise<T> {
  const timing = timingStorage.getStore();
  if (!timing) return call();
  const start = performance.now();
  try {
    return await call();
  } finally {
    timing.dbMs += performance.now() - start;
    timing.dbCalls += 1;
  }
}

type TimedSessionMethod = "run" | "executeRead" | "executeWrite";
const TIMED_SESSION_METHODS: TimedSessionMethod[] = [
  "run",
  "executeRead",
  "executeWrite",
];

/**
 * Wrap `driver.session()` so every session's query methods are timed. Covers
 * @neo4j/graphql, the OGM and custom resolvers, which all go through the same
 * driver. Wraps in place because the driver instance is shared by reference.
 */
export function instrumentDriver(driver: Driver): Driver {
  const originalSession = driver.session.bind(driver);

  driver.session = ((...args: Parameters<Driver["session"]>): Session => {
    const session = originalSession(...args);
    for (const method of TIMED_SESSION_METHODS) {
      const original = session[method].bind(session) as (
        ...methodArgs: unknown[]
      ) => Promise<unknown>;
      // `run` returns a Result. Its `then` caches one internal promise, so
      // awaiting it here alongside the caller does not consume records twice.
      // (A caller that streamed via `subscribe()` would conflict; none do.)
      (session as unknown as Record<string, unknown>)[method] = (
        ...methodArgs: unknown[]
      ) => {
        if (method === "run") {
          const result = original(...methodArgs);
          if (!timingStorage.getStore()) return result;
          void timeDbCall(() => Promise.resolve(result)).catch(() => undefined);
          return result;
        }
        return timeDbCall(() => original(...methodArgs));
      };
    }
    return session;
  }) as Driver["session"];

  return driver;
}

export type PhaseTimings = {
  queueMs?: number;
  parseMs?: number;
  validateMs?: number;
  executeMs?: number;
  totalMs: number;
  dbMs: number;
  dbCalls: number;
};

/** Format timings as a `Server-Timing` header value. */
export function formatServerTiming(timings: PhaseTimings): string {
  const entries: string[] = [];
  const add = (name: string, ms: number | undefined, desc?: string) => {
    if (ms === undefined) return;
    entries.push(
      `${name};dur=${round(ms)}${desc ? `;desc="${desc}"` : ""}`
    );
  };
  add("queue", timings.queueMs);
  add("parse", timings.parseMs);
  add("validate", timings.validateMs);
  add("execute", timings.executeMs);
  add("db", timings.dbMs, `${timings.dbCalls} calls`);
  add("total", timings.totalMs);
  return entries.join(", ");
}

/**
 * Apollo plugin: measures each phase and emits one `⏱️ GraphQL timing` log
 * line plus a `Server-Timing` header per operation.
 */
export const requestTimingPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    const startedAt = performance.now();
    const timing = timingStorage.getStore();
    let parseMs: number | undefined;
    let validateMs: number | undefined;
    let executeMs: number | undefined;

    return {
      async parsingDidStart() {
        const start = performance.now();
        return async () => {
          parseMs = performance.now() - start;
        };
      },
      async validationDidStart() {
        const start = performance.now();
        return async () => {
          validateMs = performance.now() - start;
        };
      },
      async executionDidStart() {
        const start = performance.now();
        return {
          async executionDidEnd() {
            executeMs = performance.now() - start;
          },
        };
      },
      async willSendResponse({ request, response }) {
        const now = performance.now();
        const timings: PhaseTimings = {
          queueMs: timing ? startedAt - timing.arrivedAt : undefined,
          parseMs,
          validateMs,
          executeMs,
          totalMs: now - (timing?.arrivedAt ?? startedAt),
          dbMs: timing?.dbMs ?? 0,
          dbCalls: timing?.dbCalls ?? 0,
        };

        response.http.headers.set("server-timing", formatServerTiming(timings));

        if (request.query?.includes("IntrospectionQuery")) return;
        logger.info("⏱️ GraphQL timing", {
          operationName: request.operationName || "Anonymous",
          totalMs: round(timings.totalMs),
          queueMs: timings.queueMs === undefined ? undefined : round(timings.queueMs),
          parseMs: parseMs === undefined ? undefined : round(parseMs),
          validateMs: validateMs === undefined ? undefined : round(validateMs),
          executeMs: executeMs === undefined ? undefined : round(executeMs),
          dbMs: round(timings.dbMs),
          dbCalls: timings.dbCalls,
        });
      },
    };
  },
};

const EVENT_LOOP_REPORT_INTERVAL_MS = 60_000;

/**
 * Log event-loop delay (p50/p99/max) and utilization once a minute. High
 * delay while requests are slow means the process was CPU-bound and requests
 * were waiting for the event loop, not for Neo4j.
 */
export function startEventLoopMonitor(
  intervalMs: number = EVENT_LOOP_REPORT_INTERVAL_MS
): () => void {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let lastUtilization = performance.eventLoopUtilization();

  const timer = setInterval(() => {
    const utilization = performance.eventLoopUtilization(lastUtilization);
    lastUtilization = performance.eventLoopUtilization();
    const toMs = (ns: number) => round(ns / 1e6);
    logger.info("⏱️ Event loop", {
      delayP50Ms: toMs(histogram.percentile(50)),
      delayP99Ms: toMs(histogram.percentile(99)),
      delayMaxMs: toMs(histogram.max),
      utilization: Math.round(utilization.utilization * 1000) / 1000,
    });
    histogram.reset();
  }, intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}

/**
 * Lightweight structured logger.
 *
 * Drop-in replacement for `console.*` across the server: the methods take the
 * same `(message, ...rest)` arguments, so call sites read the same. On top of
 * that it adds the things a production GraphQL server needs and `console` lacks:
 *
 *   - Levels (`debug` < `info` < `warn` < `error`) with a runtime threshold so
 *     noisy logs can be silenced in production via the `LOG_LEVEL` env var.
 *   - Structured JSON output (one object per line) when `LOG_FORMAT=json` or
 *     `NODE_ENV=production`, so logs are machine-parseable. Human-friendly
 *     coloured output otherwise.
 *   - Request correlation: any fields stashed in the AsyncLocalStorage context
 *     (e.g. a `requestId`) are merged into every log line emitted while handling
 *     that request. See `runWithContext` / `enrichContext` below.
 *
 * No external dependencies — intentionally small so it can be swapped for pino
 * or similar later without touching call sites.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { inspect } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogContext {
  /** Correlates every log line emitted while handling a single request. */
  requestId?: string;
  /** GraphQL operation name, when known. */
  operationName?: string;
  [key: string]: unknown;
}

const contextStorage = new AsyncLocalStorage<LogContext>();

/**
 * Run `fn` with the given logging context bound for its entire async lifetime.
 * Every log emitted inside (including from awaited continuations) carries the
 * context fields. Used by the request middleware to attach a `requestId`.
 */
export function runWithContext<T>(context: LogContext, fn: () => T): T {
  return contextStorage.run(context, fn);
}

/**
 * Merge additional fields into the current request's logging context, if one is
 * active. No-op outside a `runWithContext` scope.
 */
export function enrichContext(fields: LogContext): void {
  const store = contextStorage.getStore();
  if (store) Object.assign(store, fields);
}

function resolveThreshold(): number {
  const fromEnv = process.env.LOG_LEVEL?.toLowerCase();
  if (fromEnv && fromEnv in LEVEL_PRIORITY) {
    return LEVEL_PRIORITY[fromEnv as LogLevel];
  }
  return process.env.NODE_ENV === "production"
    ? LEVEL_PRIORITY.info
    : LEVEL_PRIORITY.debug;
}

let threshold = resolveThreshold();

/** Override the active log level (mainly for tests). */
export function setLogLevel(level: LogLevel): void {
  threshold = LEVEL_PRIORITY[level];
}

const useJson =
  process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production";

const useColor = !useJson && process.stdout.isTTY === true;

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack };
  }
  return arg;
}

export interface Logger {
  debug(message: unknown, ...rest: unknown[]): void;
  info(message: unknown, ...rest: unknown[]): void;
  warn(message: unknown, ...rest: unknown[]): void;
  error(message: unknown, ...rest: unknown[]): void;
  /** Returns a logger that always includes `bindings` in its output. */
  child(bindings: LogContext): Logger;
}

function emit(level: LogLevel, bindings: LogContext, args: unknown[]): void {
  if (LEVEL_PRIORITY[level] < threshold) return;

  const context: LogContext = { ...contextStorage.getStore(), ...bindings };
  const [first, ...rest] = args;
  const message = typeof first === "string" ? first : undefined;
  const extras = (message === undefined ? args : rest).map(serializeArg);

  const stream =
    level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (useJson) {
    const record: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      ...context,
    };
    if (message !== undefined) record.msg = message;
    if (extras.length === 1) record.details = extras[0];
    else if (extras.length > 1) record.details = extras;
    stream.write(JSON.stringify(record) + "\n");
    return;
  }

  // Human-readable output for local development.
  const time = new Date().toISOString();
  const label = useColor ? `${COLORS[level]}${level.toUpperCase()}${RESET}` : level.toUpperCase();
  const ctxStr = Object.keys(context).length
    ? " " + inspect(context, { colors: useColor, depth: 4 })
    : "";
  const head = `${time} ${label}${ctxStr}${message !== undefined ? " " + message : ""}`;
  const tail = extras
    .map((e) => (typeof e === "string" ? e : inspect(e, { colors: useColor, depth: 4 })))
    .join(" ");
  stream.write(tail ? `${head} ${tail}\n` : `${head}\n`);
}

function createLogger(bindings: LogContext = {}): Logger {
  return {
    debug: (message, ...rest) => emit("debug", bindings, [message, ...rest]),
    info: (message, ...rest) => emit("info", bindings, [message, ...rest]),
    warn: (message, ...rest) => emit("warn", bindings, [message, ...rest]),
    error: (message, ...rest) => emit("error", bindings, [message, ...rest]),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  };
}

export const logger: Logger = createLogger();

export default logger;

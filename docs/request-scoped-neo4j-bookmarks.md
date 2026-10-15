# Request-scoped Neo4j bookmarks

GraphQL HTTP requests use one Neo4j `BookmarkManager` for their full async
lifetime. A successful write advances that manager; a later read session sends
the resulting bookmark to Neo4j, allowing the driver to route the read to a
replica without losing read-your-own-writes consistency.

## Lifecycle and isolation

- The request middleware creates a new manager before Apollo handles the
  request and releases it when the request's async work becomes unreachable.
- The shared driver resolves the current manager when `session()` or
  `executeQuery()` is called. This covers generated GraphQL, OGM calls, custom
  resolvers, permission rules, and hooks even when they retain the application
  driver directly.
- Concurrent requests have different managers. Bookmarks are not keyed by,
  cached for, or reused between users, so one user's causal history cannot be
  disclosed to or delay another user's request.
- Work outside the HTTP request scope, including startup and background jobs,
  keeps the driver's previous behavior. An explicitly supplied manager is only
  replaced inside a request, where using one causal chain is required.

## Reader-routing scope

Only the following bounded, read-only resolver transactions are moved from
leader-routed `executeWrite` calls to `READ` sessions with `executeRead`:

- discussion detail hydration;
- discussions in a channel;
- the site-wide discussion list.

Do not move a transaction that performs a write, depends on a procedure that
requires leader execution, or runs outside request scope merely because its
Cypher currently looks read-only. Add a routed-read test when expanding this
list.

## Validation and rollout measurement

The integration test writes a probe node, confirms the request manager received
a bookmark, then reads the node through a `READ` session. Unit tests verify that
all sessions in one request share a manager and concurrent requests do not.

Before expanding reader routing beyond the three resolvers above, compare the
same production operations over equivalent traffic windows:

1. Record p50, p95, and p99 `totalMs` and `dbMs` from the existing
   `GraphQL timing` logs for the relevant operation names before deployment.
2. After deployment, record the same percentiles and request/error counts.
3. In Neo4j Aura metrics, compare leader and reader query/CPU load for those
   windows and confirm read traffic moved without bookmark-timeout errors.
4. Roll back the routed-read changes if tail latency or error rate regresses;
   bookmark propagation itself can remain enabled for later safe routes.

Store the dated before/after values in the pull request or deployment record so
the operational evidence stays tied to the rollout rather than becoming stale
repository documentation.

# Test coverage baseline

A point-in-time map of where automated tests do and don't cover the backend,
used to prioritize testing work by **risk × gap**. Snapshot taken 2026-06-24 on
`main` (post the god-file split, #57).

This is a reference, not a gate — there is intentionally **no coverage
threshold blocking PRs**.

## Reproduce

```bash
pnpm run coverage:merged
```

Runs the unit suite and the integration suite (Testcontainers Neo4j — Docker
required) under one accumulated c8 report, writing `coverage/lcov.info` plus a
text summary. This is the local equivalent of what CI produces by uploading the
`unit` and `integration` flags separately and letting Codecov merge them.

## Headline

| Metric | Unit only | **Merged (unit + integration)** |
|---|---|---|
| Lines | 47.9% | **68.2%** |
| Functions | 77% | **85%** |
| Branches | 62% | **58%** |

The unit-only number badly understates reality: the integration suite covers a
large share of the resolver and service paths. **Always reason about the merged
number** — that is what Codecov reports and the README badge shows.

## Where integration is (and isn't) carrying the load

Comparing unit-only → merged shows which areas the integration suite already
covers, and — more importantly — which it doesn't touch:

| Area | Unit | Merged | Integration adds | Read |
|---|---|---|---|---|
| customResolvers/mutations | 44% | 75% | +31 | covered |
| customResolvers/queries | 49% | 85% | +36 | covered |
| services/* (non-plugin) | 40% | 73% | +33 | covered |
| hooks | 69% | 87% | +18 | covered |
| rules/validation | 71% | 71% | +0 | partial |
| **rules/permission** | 63% | 64% | **+1** | ⚠️ security-critical, integration barely exercises denial paths |
| **rules/definitions** | 56% | 56% | **+0** | ⚠️ |
| **services/plugin** | 27% | 27% | **+0** | 🔴 dark in *both* suites |
| **middleware** | 5.7% | 5.7% | **+0** | 🔴 dark in *both* suites |

Mutations/queries/hooks are in good shape and need no dedicated effort. The real
gaps are narrower than the unit view implies.

## Genuinely dark, high-risk files (uncovered by *either* suite)

| Lines uncovered | File | % |
|---|---|---|
| 696 | `services/plugin/commentTrigger.ts` | 2.5% |
| 506 | `services/plugin/channelTrigger.ts` | 3.4% |
| 423 | `services/plugin/downloadTrigger.ts` | 3.2% |
| 380 | `middleware/issueActivityFeedMiddleware.ts` | 0% |
| 277 | `middleware/channelBotsMiddleware.ts` | 0% |
| 275 | `errorHandling.ts` | 0% |
| 231 | `middleware/wikiPageVersionHistoryMiddleware.ts` | 0% |
| 185 | `middleware/discussionVersionHistoryMiddleware.ts` | 0% |

## Risk-ranked priorities (no targets — just order of attack)

1. **Plugin triggers** (`services/plugin/*Trigger.ts`) — execute external plugin
   code and handle secrets, near-zero in both suites. Approach: unit-test the
   decision/selection logic with stubbed OGM models (no DB); integration-test the
   live execution path. *In progress: `commentTrigger.ts` 2.5% → 37.5%.*
2. **Permission rules** (`rules/permission`, `rules/definitions`) — integration
   rarely hits denial paths. Approach: the pure `evaluate*`/`resolve*` unit
   pattern.
3. **Side-effect infrastructure** (`middleware/*`, `errorHandling.ts`) — extract
   the callable handler and test that; keep the wrapper thin.

Mutations, queries, and hooks are not priorities at 75–87%.

> Caveat: some middleware is genuinely awkward to unit-test (graphql-middleware
> wrappers), so its low number partly reflects test difficulty, not neglect —
> target the extractable logic inside.

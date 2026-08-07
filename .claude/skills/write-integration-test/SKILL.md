---
name: write-integration-test
description: Write or debug an integration test that runs against a real Neo4j via Testcontainers. Use whenever adding or editing a test under tests/integration, exercising a custom resolver end-to-end, seeding Cypher, or debugging a flaky/slow integration test or its Testcontainers harness.
---

# Writing an integration test (gennit-backend)

Integration tests run each resolver/flow against a **real Neo4j** spun up by
Testcontainers. They live in `tests/integration/**` and are excluded from `pnpm test`.

## Run
- Whole suite: `pnpm run test:integration` (serial — `--test-concurrency=1`,
  `TESTCONTAINERS_REUSE_ENABLE=true`). Needs a running **Docker daemon**.
- One file: `node --loader ts-node/esm --test tests/integration/foo.test.ts`
- CI shards the suite 4 ways (`build_scripts/integration-shard.sh`, `SHARD`/`SHARD_TOTAL`);
  it's the CI bottleneck, so keep new tests focused.

## Shape (use an existing harness)
Don't hand-roll container setup — reuse a harness (e.g.
`tests/integration/imageModerationHarness.ts`) that starts the container, resets the DB,
runs Cypher, seeds actors, and builds a resolver context:
```ts
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startImageModEnv, stopImageModEnv, resetDb, run,
  seedModerator, mockToken, modContext, type ImageModEnv,
} from './imageModerationHarness.js';

let env: ImageModEnv;
before(async () => { env = await startImageModEnv(); }, { timeout: 240000 });
after(async () => { await stopImageModEnv(); });
beforeEach(async () => {
  await resetDb();
  await seedModerator({ username: 'mod1', modDisplayName: 'Mod One' });
  await run(`CREATE (img:Image { id: 'img-1', archived: false })`);
});

test('permanentlyRemoveImage removes the node', async () => {
  const res = await run(/* call the resolver / mutation via the harness */);
  assert.equal(res /* ... */, /* ... */);
});
```

## Rules
- **Long timeouts on `before`** (container start is slow — the harnesses use ~240s).
- **`resetDb()` in `beforeEach`** so tests don't leak state into each other (they run serially).
- **Seed with Cypher via the harness `run(...)`**, and assert against the DB or the
  resolver result — this is where real OGM/Cypher behavior is verified that unit tests can't.
- **Test permission-gated paths with the right context** (`modContext`, `mockToken`, …) so
  graphql-shield rules are actually exercised (see [graphql-shield-permissions](../graphql-shield-permissions/SKILL.md)).
- **Neo4j session routing:** the app uses default (leader) routing deliberately. Do not
  introduce `READ` sessions/replicas in resolvers to satisfy a test — it breaks
  read-your-own-writes on a causal cluster (CLAUDE.md → Conventions, docs/architecture.md).

## Before finishing
Run the specific integration file (Docker must be up), then `pnpm run tsc`.

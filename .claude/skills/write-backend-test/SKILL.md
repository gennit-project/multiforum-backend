---
name: write-backend-test
description: Write or fix a unit test in this Node/TypeScript backend. Use whenever adding, editing, or debugging a *.test.ts that runs under the node:test runner, mocking dependencies, or resolving a test that fails to load. Covers the node:test + node:assert/strict conventions and the ts-node/TS6 loader gotchas specific to this repo.
---

# Writing a backend unit test (gennit-backend)

Tests run on Node's built-in `node:test` runner via `ts-node/esm` — **not** Vitest/Jest.

## Run
- All unit tests: `pnpm test` (finds every `*.test.ts` except `tests/integration/**`).
- One file: `node --loader ts-node/esm --test path/to/file.test.ts`
- With coverage: `pnpm run coverage` (c8).
- Integration tests are separate — see [write-integration-test](../write-integration-test/SKILL.md).
- Note: the pre-commit hook runs `lint` + `tsc` + the **full** `pnpm test`, so a broken
  or slow test blocks commits. Keep unit tests fast and DB-free (no Neo4j).

## Conventions
- **Colocate**: `foo.ts` → `foo.test.ts` next to it. `tests/**` is also picked up.
- **Use `node:test` + `node:assert/strict`:**
  ```ts
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { parseUserMentions } from './userMentionParser.js';

  test('parseUserMentions finds unique mentions', () => {
    const mentions = parseUserMentions('hello u/alice and @Bob');
    assert.deepEqual(mentions.map((m) => m.username), ['alice', 'Bob']);
  });
  ```
- **Import source with the `.js` extension** (ES modules, `.js`-extension imports even for
  `.ts` files — matches the rest of the codebase).
- `console.*` is allowed in tests (eslint's `no-console` is off for `**/*.test.ts`), but the
  runtime code you're testing must use `logger` instead.
- Group related cases with `describe`/nested `test`; use `t.mock` (node:test's built-in
  mocking) or hand-rolled fakes for dependencies — do not pull in a new mocking library.

## Repo-specific gotchas
- **`node:`-prefixed imports and the ts-node/TS6 loader.** ts-node (10.9.2) stopped
  auto-including `@types/node` under TypeScript 6, so `import test from 'node:test'` can fail
  at load with **TS2591** even though `pnpm run tsc` passes. The fix is already in place:
  `ts-node.compilerOptions.types: ["node"]` in `tsconfig.json` (scoped to ts-node). **Do not
  remove it** — the unit tests crash on load without it. See CLAUDE.md → Toolchain notes.
- If a test file fails to even load (not an assertion failure), suspect the loader/types
  setup or a missing `.js` extension on a relative import, not the test logic.

## What to test
- Pure logic (parsers, builders, helpers, permission predicates) directly and DB-free.
- For resolver / Neo4j behavior that needs a real database, write an **integration** test
  instead (testcontainers) — see [write-integration-test](../write-integration-test/SKILL.md).

## Before finishing
Run the specific test file, then `pnpm run tsc`. Both must pass.

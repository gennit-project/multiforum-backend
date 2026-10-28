# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Run Commands
- `pnpm run codegen` - Generate GraphQL code
- `pnpm run tsc` - Run TypeScript compiler
- `pnpm run build` - Build project (codegen + tsc + copies Cypher files)
- `pnpm run start` - Start the server
- `pnpm run logSchema` - Log GraphQL schema to console
- `pnpm test` - Run unit tests
- `pnpm run test:integration` - Run integration tests against disposable Neo4j via Testcontainers
- `pnpm run lint` - Run ESLint
- `pnpm run lint:circular` - Check for circular dependencies
- `pnpm run coverage` - Run unit tests with coverage

## Dependency Constraints
- **Current stack:** `@neo4j/graphql` is declared as `^7.6.4` and
  `neo4j-driver` is pinned exactly to `6.2.0`. GraphQL 7 and Driver 6 landed
  in #398 and #402; the former v5 guardrails no longer apply.
- **graphql** stays on the manifest's `^16.14.2` range. The installed
  `@neo4j/graphql` 7.6.4 declares `graphql ^16.0.0` and
  `neo4j-driver ^5.8.0 || ^6.0.0` peers. Recheck installed package metadata
  before future upgrades; do not infer compatibility for every release.
- **No OGM:** `@neo4j/graphql-ogm` has been removed (campaign #284). Use
  driver-backed repositories in `services/persistence`, including named
  `executeGeneratedOperation` operations where appropriate. Do not restore
  `ogm.model(...)` access or the OGM dependency.
- **Type generation:** `build_scripts/generateTypes.ts` uses maintained
  `@graphql-codegen` plugins against the in-process schema, without a database
  or running server. It generates `ogm_types.ts` (a retained filename, not an
  OGM dependency) and `src/generated/graphql.ts`.
- **Public schema changes:** use the current GraphQL 7 schema and validate
  frontend documents/types when changing its contract. Backend and frontend
  compatibility work is merged (#398 and multiforum-nuxt#690); merged code and
  green CI do not establish deployment or live browser-to-backend sign-off.

## Toolchain notes
- **tsx (not ts-node)**: TypeScript scripts and tests run through `tsx`
  (`node --import tsx`), not ts-node. tsx uses esbuild to strip types, so it does
  NOT type-check at runtime — `pnpm run tsc` (and the pre-commit hook) is the type
  gate, kept separate from execution. tsx also resolves the repo's `.js`
  import specifiers back to their `.ts` sources, which native Node type-stripping
  does not do; that `.js`→`.ts` remap is why ts-node/tsx is required and plain
  `node --experimental-strip-types` is not an option. ts-node was removed because
  it had no TS6-compatible release and needed a `ts-node.compilerOptions.types`
  workaround in tsconfig.json.
- **TypeScript module resolution**: `module` and `moduleResolution` use
  `nodenext` to match the package's ESM runtime. Relative imports must include
  the emitted `.js` extension, and CommonJS dependencies may require explicit
  named imports when their declaration files expose them.

## Testing notes
- **Order-normalized snapshots**: integration `t.assert.snapshot(...)` values are
  canonicalized by `tests/helpers/snapshotSerializer.ts`, preloaded via
  `node --import` in the test scripts and `build_scripts/integration-shard.sh`.
  It sorts object keys and array elements before serializing, because Neo4j
  returns property maps and multi-row reads in an order that differs between a
  local database and CI — without this, a committed snapshot matches locally but
  fails on CI. Consequence: a snapshot does NOT witness element/property order,
  so when order is part of the contract (e.g. a paginated or `ORDER BY`'d read),
  assert it explicitly in the test body. Do not reintroduce per-test array-sort
  helpers; the serializer is the single mechanism.

## Code Style
- **Imports**: ES modules with .js extensions, grouped (third-party first, then local)
- **Naming**: camelCase for variables/functions, PascalCase for types/classes, UPPER_SNAKE for constants
- **Types**: Always use explicit TypeScript types with strict mode
- **File Structure**: Domain-based organization (rules/, customResolvers/) with feature-based subfolders
- **Error Handling**: Early returns, explicit error messages, proper error propagation
- **GraphQL**: Separate Cypher queries in .cypher files, custom resolvers for complex operations
- **Conventions**: 
  - ES2018 target with NodeNext modules
  - Use the Neo4j GraphQL library for the schema; run database operations
    through the driver-backed repositories in `services/persistence`
    (`executeGeneratedOperation` / raw driver), not the OGM — it has been removed
  - Follow existing permission system architecture (see README.md)
  - Database sessions use the driver's default (leader) routing. Do NOT switch
    reads to `READ` sessions/replicas without end-to-end Neo4j bookmark
    propagation — it breaks read-your-own-writes on a causal cluster. See the
    "Neo4j session routing" note in docs/architecture.md.

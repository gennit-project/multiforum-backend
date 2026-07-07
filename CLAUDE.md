# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Run Commands
- `pnpm run codegen` - Generate GraphQL code
- `pnpm run tsc` - Run TypeScript compiler
- `pnpm run build` - Build project (runs tsc + copies Cypher files)
- `pnpm run start` - Start the server
- `pnpm run logSchema` - Log GraphQL schema to console
- No explicit test/lint commands defined (update when added)

## Dependency Constraints (do not upgrade)
These three packages are intentionally held back because the `@neo4j/graphql`
ecosystem does not yet support the newer majors. Dependabot will keep proposing
them; the upgrades must be rejected until Neo4j ships support.
- **graphql** — pinned to `^16`. `@neo4j/graphql` (all versions, incl. latest
  7.x) and `@neo4j/graphql-ogm` declare `peerDependencies: graphql ^16.0.0`.
  graphql 17 is also ESM-only, which crashes CJS transitive deps (e.g.
  `graphql-query-complexity`) with `ERR_REQUIRE_CYCLE_MODULE` during codegen.
- **neo4j-driver** — pinned to `^5`. `@neo4j/graphql-ogm` requires
  `neo4j-driver ^5.8.0`; it does not support driver 6.
- **@neo4j/graphql** — pinned to `^5.x` to stay aligned with `@neo4j/graphql-ogm`
  (still on the 5.x line, which internally depends on `@neo4j/graphql ^5.11.4`).
  Bumping only the top-level to 7.x creates two mismatched copies in the tree.

## Toolchain notes
- **ts-node + TypeScript 6**: ts-node (10.9.2, no TS6-compatible release exists)
  stopped auto-including `@types/node` in its isolated per-file compilation under
  TS 6. This makes `node:`-prefixed builtin imports (`node:test`,
  `node:assert/strict`) fail at runtime with TS2591, even though `pnpm run tsc`
  passes. Worked around with `ts-node.compilerOptions.types: ["node"]` in
  tsconfig.json (scoped to ts-node; the main `tsc` program is untouched). Do not
  remove it or the unit tests crash on load.
- **tsconfig `ignoreDeprecations: "6.0"`**: silences TS6's deprecation of
  `moduleResolution: node10`. The real migration is `moduleResolution/module:
  nodenext` (the code is already ~99% `.js`-extension imports), deferred to avoid
  interop fallout in a dependency-bump PR.

## Code Style
- **Imports**: ES modules with .js extensions, grouped (third-party first, then local)
- **Naming**: camelCase for variables/functions, PascalCase for types/classes, UPPER_SNAKE for constants
- **Types**: Always use explicit TypeScript types with strict mode
- **File Structure**: Domain-based organization (rules/, customResolvers/) with feature-based subfolders
- **Error Handling**: Early returns, explicit error messages, proper error propagation
- **GraphQL**: Separate Cypher queries in .cypher files, custom resolvers for complex operations
- **Conventions**: 
  - ES2018 target with ESNext modules
  - Use Neo4j GraphQL library and OGM for database operations
  - Follow existing permission system architecture (see README.md)
  - Database sessions use the driver's default (leader) routing. Do NOT switch
    reads to `READ` sessions/replicas without end-to-end Neo4j bookmark
    propagation — it breaks read-your-own-writes on a causal cluster. See the
    "Neo4j session routing" note in docs/architecture.md.
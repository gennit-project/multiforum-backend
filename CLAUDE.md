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
- **neo4j-driver** — pinned to `^5`. The blocker here is specifically
  `@neo4j/graphql-ogm`, which still peer-requires `neo4j-driver ^5.8.0` and does
  not support driver 6. Note that `@neo4j/graphql` 7.x itself already supports
  driver 6 (its peer range is `neo4j-driver ^5.8.0 || ^6.0.0`), so once the OGM
  is removed this pin can move.
- **@neo4j/graphql** — pinned to `^5.x` to stay aligned with `@neo4j/graphql-ogm`
  (still on the 5.x line, which internally depends on `@neo4j/graphql ^5.11.4`).
  Bumping only the top-level to 7.x creates two mismatched copies in the tree.
  The OGM is therefore the specific remaining blocker for both driver 6 and
  `@neo4j/graphql` 7; removing it (campaign #284) unblocks both. graphql 17
  stays blocked regardless — see the graphql bullet above.

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

## Code Style
- **Imports**: ES modules with .js extensions, grouped (third-party first, then local)
- **Naming**: camelCase for variables/functions, PascalCase for types/classes, UPPER_SNAKE for constants
- **Types**: Always use explicit TypeScript types with strict mode
- **File Structure**: Domain-based organization (rules/, customResolvers/) with feature-based subfolders
- **Error Handling**: Early returns, explicit error messages, proper error propagation
- **GraphQL**: Separate Cypher queries in .cypher files, custom resolvers for complex operations
- **Conventions**: 
  - ES2018 target with NodeNext modules
  - Use Neo4j GraphQL library and OGM for database operations
  - Follow existing permission system architecture (see README.md)
  - Database sessions use the driver's default (leader) routing. Do NOT switch
    reads to `READ` sessions/replicas without end-to-end Neo4j bookmark
    propagation — it breaks read-your-own-writes on a causal cluster. See the
    "Neo4j session routing" note in docs/architecture.md.

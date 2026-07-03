# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Run Commands
- `pnpm run codegen` - Generate GraphQL code
- `pnpm run tsc` - Run TypeScript compiler
- `pnpm run build` - Build project (runs tsc + copies Cypher files)
- `pnpm run start` - Start the server
- `pnpm run logSchema` - Log GraphQL schema to console
- No explicit test/lint commands defined (update when added)

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
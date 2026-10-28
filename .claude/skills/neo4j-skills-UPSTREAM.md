# Vendored Neo4j agent skills

The `neo4j-*-skill` directories in this folder are vendored from
[`neo4j-contrib/neo4j-skills`](https://github.com/neo4j-contrib/neo4j-skills)
at commit `a678fef3e47ad3bfd3e96eff9163049c3e8a6ff7`.

Included skills:

- `neo4j-cypher-skill`
- `neo4j-driver-javascript-skill`
- `neo4j-graphql-skill`
- `neo4j-mcp-skill`
- `neo4j-modeling-skill`
- `neo4j-query-tuning-skill`

They are distributed under the MIT license in `neo4j-skills-LICENSE`.
When updating them, replace each complete directory from a single upstream
revision, move upstream `version` and `compatibility` frontmatter fields under
`metadata` for Codex compatibility, omit the installation-only `README.md`
files, reapply the project-specific guidance in the JavaScript driver and GraphQL
skills, and update the commit recorded above when the upstream revision changes.
Local documentation edits do not change that upstream provenance.

Local adaptations currently describe `neo4j-driver 6.2.0`, `@neo4j/graphql ^7.6.4`,
`graphql ^16.14.2`, removal of the OGM, and maintained `@graphql-codegen` type
generation. Preserve the repository access boundaries and in-process event engine
notes; do not restore v5-only guardrails, OGM installation/examples, or imply that
CDC/WebSocket delivery is a current project requirement. Recheck these notes
against the manifest and implementation when refreshing upstream content.

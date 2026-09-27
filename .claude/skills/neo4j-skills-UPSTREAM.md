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
files, retain the local v5 compatibility guardrail in the JavaScript driver
skill, and update the commit recorded above.

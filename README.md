[![codecov](https://codecov.io/gh/gennit-project/multiforum-backend/branch/main/graph/badge.svg)](https://codecov.io/gh/gennit-project/multiforum-backend)

# Multiforum Backend

The GraphQL/Neo4j backend for Multiforum. The frontend lives in a separate
repository: [gennit-project/multiforum-nuxt](https://github.com/gennit-project/multiforum-nuxt).

> Multiforum is under active development; test coverage is being expanded as core features stabilize.

## About

An [Apollo Server](https://www.apollographql.com/docs/apollo-server/) fetches data
from a [Neo4j](https://neo4j.com/) graph database. Some resolvers are
auto-generated using the [Neo4j GraphQL library](https://neo4j.com/docs/graphql/current/),
while more complex resolvers are implemented using a combination of the
[OGM](https://neo4j.com/docs/graphql/current/ogm/) and custom Cypher queries.

The frontend is a Nuxt/Vue application that makes GraphQL queries to this server.
For a full product overview, see the
[frontend README](https://github.com/gennit-project/multiforum-nuxt).

## Technology Summary

- **API**: Apollo Server (GraphQL)
- **Database**: Neo4j (Neo4j GraphQL library + OGM + custom Cypher)
- **Authentication**: Auth0
- **Email**: Resend or SendGrid
- **File storage**: Google Cloud Storage

## Developer Docs

- [Environment variables and running the app](./docs/environment-variables.md)
- [Permission system architecture](./docs/permission-system.md)
- [Comment notification system](./docs/notifications.md)
- [Plugin requirements](./PLUGIN_REQUIREMENTS.md)
- [Enhanced error handling](./ENHANCED_ERROR_HANDLING_USAGE.md)
- [`hasDownload` filter logic](./HASDOWNLOAD_FILTER_LOGIC.md)
- [Developer workflow and standards](./CLAUDE.md)

## Common Commands

| Command | Description |
| --- | --- |
| `npm run codegen` | Generate GraphQL code |
| `npm run tsc` | Run the TypeScript compiler |
| `npm run build` | Build the project (tsc + copy Cypher files) |
| `npm run start` | Start the server |
| `npm run logSchema` | Log the GraphQL schema to the console |

See [Environment variables and running the app](./docs/environment-variables.md)
for the configuration needed before starting the server.

## Status

This project is in active development.

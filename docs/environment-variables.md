# Environment Variables and Running the App

Configuration is supplied via environment variables (e.g. a `.env` file locally,
or Heroku config vars in production). The variables the server reads are grouped
below.

## Authentication (Auth0)

| Variable | Required | Description |
| --- | --- | --- |
| `AUTH0_DOMAIN` | Yes | Auth0 tenant domain, e.g. `your-tenant.us.auth0.com`. Used to build the JWKS URI (`https://$AUTH0_DOMAIN/.well-known/jwks.json`) for verifying access tokens and to call `/userinfo`. |
| `AUTH0_CLIENT_ID` | Yes | Client ID of the Auth0 application. A token whose `aud` equals this is treated as a UI/SPA token (the email is read from the token directly). |
| `AUTH0_AUDIENCE` | Yes (for server-session auth) | Identifier of the dedicated Auth0 API (resource server) that access tokens are issued for, e.g. `https://api.c0nduit.app`. **Not** the Auth0 Management API (`https://<tenant>/api/v2/`). |

How auth resolution works: requests authenticate by inspecting the access
token's `aud` (audience) claim in `setUserDataOnContext`
([rules/permission/userDataHelperFunctions.ts](../rules/permission/userDataHelperFunctions.ts)).
A token matching `AUTH0_CLIENT_ID` is a UI token; a token matching
`AUTH0_AUDIENCE` is treated as a programmatic / server-session token and the
user is resolved via Auth0's `/userinfo` endpoint.

Why `AUTH0_AUDIENCE` matters: the Nuxt frontend's server-session SDK
(`@auth0/auth0-nuxt`) mints access tokens for this audience. If it's unset, those
tokens fall through the audience checks and server-side user lookups are
rejected — users appear logged in but resolve with no username/profile. The
value must match the frontend's `NUXT_AUTH0_AUDIENCE`.

## Break-glass root (`SUPERADMIN_EMAIL`)

| Variable | Required | Description |
| --- | --- | --- |
| `SUPERADMIN_EMAIL` | Recommended | Email of the **env break-glass root**. A caller whose verified token email equals this value holds **every** capability unconditionally, bypassing all role/tier checks (`rules/permission/isServerRoot.ts`). It is immutable from the database and cannot be locked out, so it can bootstrap the first `SuperAdmin` on a fresh install and recover if `ServerConfig.SuperAdmins` is ever emptied. It is the **only** unconditional override — and the only actor a suspension cannot restrict. Keep it to a tightly controlled account; day-to-day administration should go through the `SuperAdmins`/`Admins` tiers, not root. See [permission-system.md](./permission-system.md). |

`CYPRESS_ADMIN_TEST_EMAIL` (below) is honored by the same root check, so in
test/E2E environments the seeded admin test user also acts as root.

## Database (Neo4j)

| Variable | Required | Description |
| --- | --- | --- |
| `NEO4J_URI` | Yes | Bolt connection URI for the Neo4j database, e.g. `neo4j+s://<id>.databases.neo4j.io` or `bolt://127.0.0.1:7687`. |
| `NEO4J_USER` | Yes | Neo4j username (typically `neo4j`). |
| `NEO4J_PASSWORD` | Yes | Neo4j password. |

## Email

| Variable | Required | Description |
| --- | --- | --- |
| `EMAIL_PROVIDER` | If sending email | Which provider to use: `resend` or `sendgrid`. |
| `EMAIL_FROM` | If sending email | Default "from" address for outbound email. |
| `RESEND_API_KEY` | If `EMAIL_PROVIDER=resend` | API key for [Resend](https://resend.com). |
| `SENDGRID_API_KEY` | If `EMAIL_PROVIDER=sendgrid` | API key for SendGrid. |
| `SENDGRID_FROM_EMAIL` | If using SendGrid | Verified SendGrid sender address. |
| `SUPPORT_EMAIL` | No | Destination address for support/contact messages. |

## File storage (Google Cloud Storage)

| Variable | Required | Description |
| --- | --- | --- |
| `GCS_BUCKET_NAME` | If uploads enabled | Google Cloud Storage bucket for uploaded images/files. |
| `GOOGLE_CREDENTIALS_BASE64` | If uploads enabled | Base64-encoded GCP service-account JSON. At startup it is decoded to a file and `GOOGLE_APPLICATION_CREDENTIALS` is pointed at it (convenient for single-value secrets on Heroku). |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alternative to the above | Filesystem path to a GCP service-account JSON file. Set automatically when `GOOGLE_CREDENTIALS_BASE64` is provided. |
| `DOWNLOAD_SCAN_CACHE_TTL_MS` | No | How long a clean pre-download security verdict may be reused (default `900000`, or 15 minutes). Set to `0` to scan on every download request. Failed or held verdicts are never reused. |

## Server / app

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Port the Apollo server listens on (defaults are provided in code; Heroku sets this automatically). |
| `NODE_ENV` | No | Standard Node environment (`development` / `production` / `test`). |
| `GRAPHQL_MAX_DEPTH` | No | Maximum allowed GraphQL query nesting depth (default `15`). Deeper queries are rejected before execution to prevent one crafted query from generating a pathological Cypher query. |
| `SERVER_CONFIG_NAME` | Yes | Name of the `ServerConfig` record this instance runs as (e.g. `Listical`). The special value `Cypress Test Server` enables test-only behavior. |
| `FRONTEND_URL` | Yes | Base URL of the frontend, used to build links in outbound emails (e.g. mod-invite acceptance links). |
| `PLUGIN_SECRET_ENCRYPTION_KEY` | If plugins store secrets | 32-character key used to encrypt plugin secrets at rest. Set a strong value in production (the in-code fallback is a placeholder only). |

## Build / development / test

| Variable | Required | Description |
| --- | --- | --- |
| `GENERATE_OGM_TYPES` | No | Set to `true` to (re)generate the Neo4j OGM TypeScript types during startup/build. |
| `E2E_MOCK_AUTH` | Test only | Set to `true` to enable mocked authentication for end-to-end runs. |
| `PLAYWRIGHT_MOCK_AUTH` | Test only | Set to `true` to enable mocked authentication during Playwright runs. |
| `CYPRESS_ADMIN_TEST_EMAIL` | Test only | Email of the seeded admin test user for E2E runs. |
| `CYPRESS_ADMIN_TEST_USERNAME` | Test only | Username of the seeded admin test user for E2E runs. |

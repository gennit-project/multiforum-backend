# Environment Variables and Running the App

Configuration is supplied via environment variables (e.g. a `.env` file locally,
or Heroku config vars in production). The variables the server reads are grouped
below.

## Authentication

`MULTIFORUM_AUTH_PROVIDER` selects the authentication provider. Leave it unset
or set it to `auth0` for the production Auth0 flow. The production `oidc`
provider accepts standards-compatible issuers such as Keycloak or Zitadel. The
alternative
`local-dev` provider is a single-identity convenience for local Docker Compose
evaluation only: server startup rejects it when `NODE_ENV=production`.

### Auth0

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

### Generic OpenID Connect

Set `MULTIFORUM_AUTH_PROVIDER=oidc` to validate access tokens from a
standards-compatible OpenID Provider. This backend contract is the foundation
for generic OIDC frontend sessions; selecting it before the corresponding
frontend support is deployed will not create login routes.

| Variable | Required | Description |
| --- | --- | --- |
| `OIDC_ISSUER_URL` | Yes | Exact HTTPS issuer identifier expected in the access token's `iss` claim. |
| `OIDC_AUDIENCE` | Yes | API/resource-server audience required in the access token's `aud` claim. |
| `OIDC_JWKS_URL` | Yes | HTTPS JSON Web Key Set endpoint used to verify token signatures and key rotation. |
| `OIDC_USERINFO_URL` | Yes | HTTPS UserInfo endpoint used to resolve the authenticated email. It must return the same `sub` as the access token and `email_verified: true`. |

OIDC access tokens must be RS256-signed, unexpired, and contain a subject. The
backend validates the signature, issuer, and audience before calling UserInfo,
then requires the UserInfo subject to match the token. Email addresses that the
provider has not affirmatively verified are rejected. Endpoint URLs must use
HTTPS and cannot contain embedded credentials, queries, or fragments.

### Local development authentication

| Variable | Required | Description |
| --- | --- | --- |
| `MULTIFORUM_AUTH_PROVIDER` | Yes | Set to `local-dev`. Any other non-Auth0 value fails startup. Requires `NODE_ENV=development`; an unset, test, or production environment is rejected. |
| `MULTIFORUM_BOOTSTRAP_EMAIL` | Yes | Verified email placed in the signed development token. With automatic provisioning enabled on an empty database, startup also creates this email relationship. |
| `MULTIFORUM_BOOTSTRAP_USERNAME` | Yes | Fixed subject/username claim for the development token. With automatic provisioning enabled on an empty database, startup creates this user and connects it as the first SuperAdmin. The permission layer still resolves the persisted user through the email relationship. |
| `MULTIFORUM_BOOTSTRAP_PASSWORD` | Yes | Password used both to authenticate the local sign-in request and sign HS256 tokens. Must contain at least 12 characters. |
| `SUPERADMIN_EMAIL` | Yes | Must exactly match `MULTIFORUM_BOOTSTRAP_EMAIL`, ensuring the one local identity can bootstrap and recover administration. |

When enabled, `POST /auth/local-dev/token` accepts a small JSON body and returns
a 12-hour bearer token:

```bash
curl --request POST http://localhost:4000/auth/local-dev/token \
  --header 'Content-Type: application/json' \
  --data '{"password":"your-local-password"}'
```

Responses include `Cache-Control: no-store`. Tokens accept only HS256, require
the Multiforum local issuer and backend audience, and must exactly match the
configured email, username, and verified-email claims. Invalid tokens are
handled like invalid Auth0 tokens. The route returns 404 when local auth is not
enabled.

This mode is intentionally a single development identity. It has no password
reset, account database, multi-user credential management, or production
security support. Use Auth0 (and later a supported OIDC provider) for public
deployments.

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
| `GCS_BUCKET_NAME` | If media uploads enabled | Google Cloud Storage bucket for publicly rendered image/media uploads. |
| `GCS_PRIVATE_DOWNLOAD_BUCKET_NAME` | If downloadable-file uploads enabled | Dedicated non-public Google Cloud Storage bucket for downloadable files. Do not grant `allUsers` or `allAuthenticatedUsers` object access; downloads and plugin scans use short-lived signed read URLs. |
| `GOOGLE_CREDENTIALS_BASE64` | If uploads enabled | Base64-encoded GCP service-account JSON. At startup it is decoded to a file and `GOOGLE_APPLICATION_CREDENTIALS` is pointed at it (convenient for single-value secrets on Heroku). |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alternative to the above | Filesystem path to a GCP service-account JSON file. Set automatically when `GOOGLE_CREDENTIALS_BASE64` is provided. |
| `DOWNLOAD_SCAN_CACHE_TTL_MS` | No | How long a clean pre-download security verdict may be reused (default `900000`, or 15 minutes). Set to `0` to scan on every download request. Failed or held verdicts are never reused. |

## Server / app

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Port the Apollo server listens on (defaults are provided in code; Heroku sets this automatically). |
| `NODE_ENV` | No | Standard Node environment (`development` / `production` / `test`). |
| `NODE_OPTIONS` | Recommended on memory-limited hosts | Standard Node runtime flags. On a 1 GB Heroku dyno, use `--max-old-space-size=768` so runtime schema generation triggers garbage collection before exceeding the dyno memory quota. The Heroku build script overrides this with a 2 GB heap because GraphQL/OGM type generation needs more memory during compilation. Re-test both values after materially expanding the GraphQL schema or changing dyno size. |
| `GRAPHQL_MAX_DEPTH` | No | Maximum allowed GraphQL query nesting depth (default `15`). Deeper queries are rejected before execution to prevent one crafted query from generating a pathological Cypher query. |
| `SERVER_CONFIG_NAME` | Yes | Name of the `ServerConfig` record this instance runs as (e.g. `Listical`). When automatic provisioning is enabled, Multiforum uses this name to create the config and install or update its default roles. The special value `Cypress Test Server` enables test-only behavior. |
| `MULTIFORUM_AUTO_PROVISION` | No | Set to `true`, `1`, `yes`, or `on` to create or reconcile the named `ServerConfig` and its default roles during startup. In `local-dev` auth mode, an empty user database also receives the configured bootstrap user, email, moderation profile, and SuperAdmin connection. A non-empty database is never seeded with a new identity; an exact existing bootstrap identity is only reconciled into SuperAdmins. It is disabled by default, so existing deployments are unchanged. The operation is idempotent; an opted-in provisioning error fails startup rather than accepting traffic with partial defaults. |
| `FRONTEND_URL` | Yes | Base URL of the frontend, used to build links in outbound emails (e.g. mod-invite acceptance links). |
| `PLUGIN_SECRET_ENCRYPTION_KEY` | If plugins store secrets | 32-character key used to encrypt plugin secrets at rest. Set a strong value in production (the in-code fallback is a placeholder only). |

### Capability reporting

The public `getInstanceSetupStatus` query reports whether optional integrations
are configured and enabled. It returns missing environment-variable names but
never their values. Because maps and geocoding currently execute in the Nuxt
frontend, pass `VITE_GOOGLE_MAPS_API_KEY` and `VITE_OPEN_CAGE_API_KEY` through
to the backend process as presence-only signals when using this query. The
Docker Compose quick-start profile will pass these through when it enables the
capability-based frontend.

## Build / development / test

| Variable | Required | Description |
| --- | --- | --- |
| `GENERATE_OGM_TYPES` | No | Set to `true` to (re)generate the Neo4j OGM TypeScript types during startup/build. |
| `E2E_MOCK_AUTH` | Test only | Set to `true` to enable mocked authentication for end-to-end runs. |
| `PLAYWRIGHT_MOCK_AUTH` | Test only | Set to `true` to enable mocked authentication during Playwright runs. |
| `CYPRESS_ADMIN_TEST_EMAIL` | Test only | Email of the seeded admin test user for E2E runs. |
| `CYPRESS_ADMIN_TEST_USERNAME` | Test only | Username of the seeded admin test user for E2E runs. |

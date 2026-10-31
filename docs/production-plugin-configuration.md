# Production plugin configuration ownership

The reviewed source of truth for production plugin configuration is
[`deployment/plugin-configuration/production.template.json`](../deployment/plugin-configuration/production.template.json).
It owns the complete production server pipeline list, the default and
experimental registry URLs, the security scanner, the LLM moderation plugin,
and the LLM trial forum enablement. Do not add a service-owned workflow that
applies a partial server pipeline list.

The template contains only non-secret desired state and opaque `env:` secret
references. The production workflow renders deployment-specific values and
passes secret values directly from the protected GitHub `production`
environment to `mfctl`; they are never written to the manifest, repository,
workflow summary, or Terraform state.

## Protected production configuration

Configure these GitHub environment variables:

- `MULTIFORUM_GRAPHQL_URL`
- `MULTIFORUM_OAUTH_TOKEN_URL`
- `MULTIFORUM_OAUTH_CLIENT_ID`
- `MULTIFORUM_OAUTH_AUDIENCE`
- `SCAN_SERVICE_URL`
- `LLM_MODERATION_SERVICE_URL`
- `LLM_MODERATION_TRIAL_FORUM`

Configure these GitHub environment secrets:

- `MULTIFORUM_OAUTH_CLIENT_SECRET`
- `SCAN_API_KEY`
- `MOD_API_KEY`

The backend must allowlist the OAuth client's exact subject through
`PLUGIN_CONFIGURATION_AUTOMATION_SUBJECTS`.

## Review and apply process

Pull requests that change the template, renderer, CLI, or workflow render a
secret-free validation manifest and run the renderer tests. To inspect live
drift, manually run **Reconcile production plugin configuration** with
`operation=plan`. The production environment approval protects access to the
scoped OAuth credentials. Plan does not read the plugin shared secrets;
`SCAN_API_KEY` and `MOD_API_KEY` are exposed only to an apply run.

After the change is reviewed and merged, run the workflow from `main` with
`operation=apply`. Apply is rejected on other branches. The workflow uses its
exact `GITHUB_SHA` for both the desired state and `mfctl`, publishes a redacted
summary, and fails if apply leaves drift. Re-running it is idempotent.

Service deployment automation may pass `scan_service_url` or
`llm_moderation_service_url` to the workflow dispatch. These non-secret,
per-deployment overrides avoid a manual variable update while the central
workflow continues to own the complete topology and all plugin secrets.

## Adding or changing a plugin

Update the central template in one pull request, including its exact version,
settings, secret references, channel relationships, and event pipelines. Add
or update renderer tests that assert the resulting topology. If a service URL
or rollout forum is environment-specific, add a named renderer token and a
protected environment variable rather than embedding a production value.

Service deployment workflows may trigger or link to this central workflow
after deployment, but they must not independently apply server plugin
topology. This keeps pipeline ownership reviewable and prevents one service
from deleting another service's events.

# Declarative plugin configuration

Multiforum exposes an admin-only, read-only reconciliation preview for server
plugins. It is the first half of a plan/apply workflow: operators can describe
the intended versions, settings, required secret names, and server pipelines,
then inspect drift without changing production.

The current manifest version is `multiforum.gennit.dev/v1alpha1`. Manifests are
additive: plugins omitted from the manifest are not disabled or uninstalled.
For each listed plugin, only the exact version named by the manifest is
managed. `settingsJson`, legacy `requiredSecrets`, and resolvable `secretRefs`
are independently optional.

Pipeline handling is intentionally explicit:

- Omit `pipelines` to leave all server pipelines unmanaged.
- Pass `pipelines: []` to declare that the server should have no pipelines.
- Pass a list to manage the complete server pipeline list.
- Generated `effectiveAt` and `policyId` values are ignored unless the manifest
  explicitly supplies them, preventing perpetual drift after pipeline creation.

## Preview drift

Call `previewPluginConfigurationReconciliation` as a user with the existing
`canManagePlugins` permission:

```graphql
query PreviewPluginConfiguration(
  $manifest: PluginConfigurationDesiredStateInput!
) {
  previewPluginConfigurationReconciliation(manifest: $manifest) {
    apiVersion
    inSync
    warnings
    changes {
      kind
      path
      message
      current
      desired
      blocked
    }
  }
}
```

Example variables for the security scanner:

```json
{
  "manifest": {
    "apiVersion": "multiforum.gennit.dev/v1alpha1",
    "plugins": [
      {
        "pluginId": "security-attachment-scan",
        "version": "0.4.0",
        "enabled": true,
        "settingsJson": {
          "serviceUrl": "https://security-scan-service.example.run.app"
        },
        "secretRefs": [
          {
            "key": "SCAN_SERVICE_API_KEY",
            "valueFrom": "env:SCAN_API_KEY"
          }
        ]
      }
    ],
    "pipelines": [
      {
        "event": "downloadableFile.created",
        "steps": [
          {
            "pluginId": "security-attachment-scan",
            "version": "0.4.0"
          }
        ],
        "applicability": "NEW_FILES_ONLY"
      }
    ]
  }
}
```

The preview never returns secret values. Missing or explicitly invalid secrets
appear as blocked changes. A set-but-untested secret satisfies declarative
presence because Multiforum has no separate secret-validation operation; the
plugin still validates credentials when it uses them.

## Apply drift

`applyPluginConfiguration` uses the same manifest and accepts secret values in
a separate, ephemeral variable. The caller resolves each opaque `valueFrom`
reference (for example from a CI environment secret) and sends only the
resolutions needed for the request:

```graphql
mutation ApplyPluginConfiguration(
  $manifest: PluginConfigurationDesiredStateInput!
  $secretResolutions: [PluginSecretResolutionInput!]!
) {
  applyPluginConfiguration(
    manifest: $manifest
    secretResolutions: $secretResolutions
  ) {
    status
    message
    operations { kind path status message }
    planAfter { inSync changes { kind path message } }
  }
}
```

```json
{
  "secretResolutions": [
    {
      "valueFrom": "env:SCAN_API_KEY",
      "value": "resolved-at-runtime-and-never-committed"
    }
  ]
}
```

Apply performs a complete preflight before mutating anything, then installs
versions, sets required secrets, configures/enables plugins, and updates
pipelines in that order. It stops on the first failure and returns the
successfully applied operations plus a fresh drift plan. Secret values are
redacted from failure messages and never returned.

Secret values are intentionally write-only, so reconciliation cannot compare
an existing value with a newly resolved value. When a caller supplies a
resolution for a declared `secretRef`, apply always writes it, even if the
preview reports no structural drift. This makes CI-driven secret rotation
reliable: rerunning apply refreshes the backend value from the current secret
store. `NO_CHANGES` is returned only when the configuration is in sync and the
request supplies no secret resolutions.

## Operator CLI

The bundled `mfctl` command turns these GraphQL operations into a repeatable
local or CI workflow. Keep the JSON manifest in source control while storing
its referenced values and credentials in the CI secret store.

For interactive use, supply an existing user token:

```bash
export MULTIFORUM_GRAPHQL_URL=https://forum.example/graphql
export MULTIFORUM_ACCESS_TOKEN=your-existing-user-access-token
export SCAN_API_KEY=resolved-only-at-runtime

pnpm mfctl plugin-config plan --manifest examples/plugin-configuration.json
pnpm mfctl plugin-config apply --manifest examples/plugin-configuration.json
```

That token must belong to an existing Multiforum user whose server role grants
`canManagePlugins`. For CI, `mfctl` can instead obtain a short-lived token
using OAuth client credentials:

```bash
export MULTIFORUM_GRAPHQL_URL=https://forum.example/graphql
export MULTIFORUM_OAUTH_TOKEN_URL=https://your-tenant.auth0.com/oauth/token
export MULTIFORUM_OAUTH_CLIENT_ID=stored-in-ci
export MULTIFORUM_OAUTH_CLIENT_SECRET=stored-in-ci
export MULTIFORUM_OAUTH_AUDIENCE=https://api.example
export MULTIFORUM_OAUTH_SCOPE=plugin-configuration:write
export SCAN_API_KEY=resolved-only-at-runtime

pnpm mfctl plugin-config apply --manifest examples/plugin-configuration.json
```

Configure the backend's exact service-token subject in
`PLUGIN_CONFIGURATION_AUTOMATION_SUBJECTS` as described in
[environment variables](./environment-variables.md#plugin-configuration-automation).
For Auth0 this is normally `<client-id>@clients`. The client ID and secret
stay in CI; they are not configured on Multiforum.

Tokens and client secrets are never written to CLI output. `plan` does not
resolve or transmit referenced plugin secrets. `apply` currently supports
`env:NAME` references and sends those values only in the apply request;
neither values nor the request body are logged.

Use `--endpoint` to override `MULTIFORUM_GRAPHQL_URL` and `--json` for
machine-readable output. Exit codes are suitable for CI:

- `0`: in sync, or apply converged successfully
- `1`: invalid input, request failure, blocked/failed apply, or remaining drift
- `2`: plan succeeded and found drift

The example manifest is at `examples/plugin-configuration.json`. Machine
identities are intentionally narrower than `canManagePlugins`: even a valid
allowlisted service token is accepted only by the two reconciliation
operations.

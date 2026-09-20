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

# Declarative plugin configuration

Multiforum exposes an admin-only, read-only reconciliation preview for server
plugins. It is the first half of a plan/apply workflow: operators can describe
the intended versions, settings, required secret names, and server pipelines,
then inspect drift without changing production.

The current manifest version is `multiforum.gennit.dev/v1alpha1`. Manifests are
additive: plugins omitted from the manifest are not disabled or uninstalled.
For each listed plugin, only the exact version named by the manifest is
managed. `settingsJson` and `requiredSecrets` are independently optional.

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
        "requiredSecrets": ["SCAN_SERVICE_API_KEY"]
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

The preview never returns secret values. A missing, invalid, or untested secret
appears as a blocked change because the API received only the required key
name. A later apply client can resolve secret references at execution time
without putting plaintext values in a committed manifest.

This endpoint does not mutate configuration. An apply operation, secret-source
references, and CI policy checks belong to the next work slice.

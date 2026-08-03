import test from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateManifestSecretDiagnostics,
  formatDuplicateManifestSecretDiagnostic,
} from "./pluginManifest.js";

test("findDuplicateManifestSecretDiagnostics returns no diagnostics for clean manifests", () => {
  const diagnostics = findDuplicateManifestSecretDiagnostics({
    id: "clean-plugin",
    version: "1.0.0",
    secrets: [{ key: "API_KEY", scope: "server" }],
    ui: {
      forms: {
        server: [{ fields: [{ key: "TIMEOUT" }] }],
        channel: [{ fields: [{ key: "CHANNEL_NAME" }] }],
      },
    },
  });

  assert.deepEqual(diagnostics, []);
});

test("findDuplicateManifestSecretDiagnostics detects one duplicate key", () => {
  const diagnostics = findDuplicateManifestSecretDiagnostics({
    id: "dup-plugin",
    version: "1.0.0",
    secrets: [{ key: "API_KEY", scope: "server" }],
    ui: {
      forms: {
        server: [{ fields: [{ key: "API_KEY" }] }],
      },
    },
  });

  assert.deepEqual(diagnostics, [
    {
      pluginId: "dup-plugin",
      version: "1.0.0",
      scope: "server",
      duplicateKeys: ["API_KEY"],
    },
  ]);
});

test("findDuplicateManifestSecretDiagnostics detects multiple duplicate keys", () => {
  const diagnostics = findDuplicateManifestSecretDiagnostics({
    id: "dup-plugin",
    version: "1.0.0",
    secrets: [
      { key: "API_KEY", scope: "server" },
      { key: "WEBHOOK_URL", scope: "server" },
    ],
    ui: {
      forms: {
        server: [
          { fields: [{ key: "WEBHOOK_URL" }, { key: "API_KEY" }, { key: "OTHER" }] },
        ],
      },
    },
  });

  assert.deepEqual(diagnostics, [
    {
      pluginId: "dup-plugin",
      version: "1.0.0",
      scope: "server",
      duplicateKeys: ["API_KEY", "WEBHOOK_URL"],
    },
  ]);
});

test("findDuplicateManifestSecretDiagnostics keeps server and channel scopes separate", () => {
  const diagnostics = findDuplicateManifestSecretDiagnostics({
    id: "scoped-plugin",
    version: "2.0.0",
    secrets: [
      { key: "SERVER_SECRET", scope: "server" },
      { key: "CHANNEL_SECRET", scope: "channel" },
    ],
    ui: {
      forms: {
        server: [{ fields: [{ key: "SERVER_SECRET" }, { key: "CHANNEL_SECRET" }] }],
        channel: [{ fields: [{ key: "CHANNEL_SECRET" }] }],
      },
    },
  });

  assert.deepEqual(diagnostics, [
    {
      pluginId: "scoped-plugin",
      version: "2.0.0",
      scope: "server",
      duplicateKeys: ["SERVER_SECRET"],
    },
    {
      pluginId: "scoped-plugin",
      version: "2.0.0",
      scope: "channel",
      duplicateKeys: ["CHANNEL_SECRET"],
    },
  ]);
});

test("formatDuplicateManifestSecretDiagnostic includes plugin, version, scope, and keys", () => {
  const message = formatDuplicateManifestSecretDiagnostic({
    pluginId: "dup-plugin",
    version: "1.2.3",
    scope: "channel",
    duplicateKeys: ["CHANNEL_SECRET", "TOKEN"],
  });

  assert.match(message, /dup-plugin@1.2.3/);
  assert.match(message, /ui\.forms\.channel/);
  assert.match(message, /CHANNEL_SECRET, TOKEN/);
});

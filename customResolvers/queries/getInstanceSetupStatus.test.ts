import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstanceSetupStatus,
  default as getInstanceSetupStatus,
} from "./getInstanceSetupStatus.js";

test("reports missing integrations without exposing environment values", () => {
  const status = buildInstanceSetupStatus({
    env: {},
    serverConfig: null,
  });

  assert.deepEqual(status, {
    auth: {
      configured: false,
      enabled: false,
      requiredEnvVarsMissing: [
        "AUTH0_DOMAIN",
        "AUTH0_CLIENT_ID",
        "AUTH0_AUDIENCE",
      ],
      setupUrl: "/admin/setup#authentication",
      docsPath: "/authentication",
    },
    mail: {
      configured: false,
      enabled: false,
      requiredEnvVarsMissing: ["EMAIL_FROM", "RESEND_API_KEY"],
      setupUrl: "/admin/setup#email",
      docsPath: "/roles/admins/email-notifications",
    },
    maps: {
      configured: false,
      enabled: false,
      requiredEnvVarsMissing: ["VITE_GOOGLE_MAPS_API_KEY"],
      setupUrl: "/admin/setup#maps",
      docsPath: "/roles/admins/map-setup",
    },
    geocoding: {
      configured: false,
      enabled: false,
      requiredEnvVarsMissing: ["VITE_OPEN_CAGE_API_KEY"],
      setupUrl: "/admin/setup#geocoding",
      docsPath: "/roles/admins/map-setup",
    },
    uploads: {
      configured: false,
      enabled: false,
      requiredEnvVarsMissing: ["GCS_BUCKET_NAME"],
      setupUrl: "/admin/setup#file-uploads",
      docsPath: "/roles/admins/image-hosting",
    },
    downloads: {
      configured: false,
      enabled: false,
      requiredEnvVarsMissing: ["GCS_PRIVATE_DOWNLOAD_BUCKET_NAME"],
      setupUrl: "/admin/setup#downloads",
      docsPath: "/roles/forum-owners/downloads-setup",
    },
    events: {
      configured: false,
      enabled: false,
      requiredEnvVarsMissing: [],
      setupUrl: "/admin/setup#events",
      docsPath: "/config/server-config",
    },
    plugins: {
      configured: false,
      enabled: false,
      requiredEnvVarsMissing: ["PLUGIN_SECRET_ENCRYPTION_KEY"],
      setupUrl: "/admin/setup#plugins",
      docsPath: "/roles/admins/plugin-pipelines",
    },
  });
});

test("combines configured integrations with server feature toggles", () => {
  const status = buildInstanceSetupStatus({
    env: {
      AUTH0_DOMAIN: "tenant.example",
      AUTH0_CLIENT_ID: "client-secret-value",
      AUTH0_AUDIENCE: "https://api.example",
      EMAIL_PROVIDER: "sendgrid",
      EMAIL_FROM: "forum@example.test",
      SENDGRID_API_KEY: "mail-secret-value",
      VITE_GOOGLE_MAPS_API_KEY: "maps-secret-value",
      VITE_OPEN_CAGE_API_KEY: "geocoding-secret-value",
      GCS_BUCKET_NAME: "public-media",
      GCS_PRIVATE_DOWNLOAD_BUCKET_NAME: "private-downloads",
      PLUGIN_SECRET_ENCRYPTION_KEY: "plugin-secret-value",
    },
    serverConfig: { enableDownloads: true, enableEvents: false },
  });

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(status).map(([name, item]) => [
        name,
        {
          configured: item.configured,
          enabled: item.enabled,
          missing: item.requiredEnvVarsMissing,
        },
      ])
    ),
    {
      auth: { configured: true, enabled: true, missing: [] },
      mail: { configured: true, enabled: true, missing: [] },
      maps: { configured: true, enabled: true, missing: [] },
      geocoding: { configured: true, enabled: true, missing: [] },
      uploads: { configured: true, enabled: true, missing: [] },
      downloads: { configured: true, enabled: true, missing: [] },
      events: { configured: true, enabled: false, missing: [] },
      plugins: { configured: true, enabled: true, missing: [] },
    }
  );
  assert.equal(JSON.stringify(status).includes("secret-value"), false);
});

test("reports invalid email providers as needing EMAIL_PROVIDER", () => {
  const status = buildInstanceSetupStatus({
    env: { EMAIL_PROVIDER: "smtp" },
    serverConfig: null,
  });

  assert.deepEqual(status.mail.requiredEnvVarsMissing, ["EMAIL_PROVIDER"]);
});

test("reports a complete local development auth provider as configured", () => {
  const status = buildInstanceSetupStatus({
    env: {
      NODE_ENV: "development",
      MULTIFORUM_AUTH_PROVIDER: "local-dev",
      MULTIFORUM_BOOTSTRAP_EMAIL: "admin@example.test",
      MULTIFORUM_BOOTSTRAP_USERNAME: "admin",
      MULTIFORUM_BOOTSTRAP_PASSWORD: "local-password",
      SUPERADMIN_EMAIL: "admin@example.test",
    },
    serverConfig: null,
  });

  assert.deepEqual(status.auth, {
    configured: true,
    enabled: true,
    requiredEnvVarsMissing: [],
    setupUrl: "/admin/setup#authentication",
    docsPath: "/authentication",
  });
});

test("reports missing local development auth settings instead of Auth0 settings", () => {
  const status = buildInstanceSetupStatus({
    env: { MULTIFORUM_AUTH_PROVIDER: "local-dev" },
    serverConfig: null,
  });

  assert.deepEqual(status.auth.requiredEnvVarsMissing, [
    "NODE_ENV",
    "MULTIFORUM_BOOTSTRAP_EMAIL",
    "MULTIFORUM_BOOTSTRAP_USERNAME",
    "MULTIFORUM_BOOTSTRAP_PASSWORD",
    "SUPERADMIN_EMAIL",
  ]);
});

test("reports generic OIDC authentication readiness", () => {
  const missing = buildInstanceSetupStatus({
    env: { MULTIFORUM_AUTH_PROVIDER: "oidc" },
    serverConfig: null,
  });
  assert.deepEqual(missing.auth.requiredEnvVarsMissing, [
    "OIDC_ISSUER_URL",
    "OIDC_AUDIENCE",
    "OIDC_JWKS_URL",
    "OIDC_USERINFO_URL",
  ]);

  const configured = buildInstanceSetupStatus({
    env: {
      MULTIFORUM_AUTH_PROVIDER: "oidc",
      OIDC_ISSUER_URL: "https://identity.example.test/realms/multiforum",
      OIDC_AUDIENCE: "multiforum-api",
      OIDC_JWKS_URL: "https://identity.example.test/realms/multiforum/certs",
      OIDC_USERINFO_URL:
        "https://identity.example.test/realms/multiforum/userinfo",
    },
    serverConfig: null,
  });
  assert.deepEqual(configured.auth.requiredEnvVarsMissing, []);
  assert.equal(configured.auth.configured, true);
  assert.equal(configured.auth.enabled, true);
});

test("resolves the named ServerConfig before building status", async () => {
  const calls: unknown[] = [];
  const ServerConfig = {
    find: async (args: unknown) => {
      calls.push(args);
      return [{ enableDownloads: true, enableEvents: true }];
    },
  };
  const resolver = getInstanceSetupStatus({
    ServerConfig: ServerConfig as never,
    env: {
      SERVER_CONFIG_NAME: "Community Forum",
      GCS_PRIVATE_DOWNLOAD_BUCKET_NAME: "private-downloads",
    },
  });

  const result = await resolver();

  assert.deepEqual(calls, [
    {
      where: { serverName: "Community Forum" },
      selectionSet: "{ serverName enableDownloads enableEvents }",
    },
  ]);
  assert.equal(result.downloads.enabled, true);
  assert.equal(result.events.enabled, true);
});

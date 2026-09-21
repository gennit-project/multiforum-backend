import assert from "node:assert/strict";
import test from "node:test";

import type { GraphQLContext } from "../types/context.js";
import {
  DEFAULT_PLUGIN_CONFIGURATION_SCOPE,
  assertPluginConfigurationAutomationConfiguration,
  authenticatePluginConfigurationAutomation,
  getPluginConfigurationAutomationSettings,
} from "./pluginConfigurationAutomationAuth.js";

const auth0Environment = {
  MULTIFORUM_AUTH_PROVIDER: "auth0",
  AUTH0_DOMAIN: "tenant.example.test",
  AUTH0_AUDIENCE: "https://api.example.test",
  PLUGIN_CONFIGURATION_AUTOMATION_SUBJECTS:
    "client-one@clients, client-two@clients",
};

const oidcEnvironment = {
  MULTIFORUM_AUTH_PROVIDER: "oidc",
  OIDC_ISSUER_URL: "https://identity.example.test/realms/multiforum",
  OIDC_AUDIENCE: "multiforum-api",
  OIDC_JWKS_URL: "https://identity.example.test/realms/multiforum/certs",
  OIDC_USERINFO_URL: "https://identity.example.test/realms/multiforum/userinfo",
  PLUGIN_CONFIGURATION_AUTOMATION_SUBJECTS: "ci-service",
};

const contextWithToken = (token = "service-token"): GraphQLContext =>
  ({
    req: { headers: { authorization: "Bearer " + token } },
  }) as unknown as GraphQLContext;

test("automation is disabled unless subjects are explicitly configured", () => {
  assert.equal(getPluginConfigurationAutomationSettings({}), null);
  assert.doesNotThrow(() =>
    assertPluginConfigurationAutomationConfiguration({})
  );
});

test("builds strict Auth0 and generic OIDC verifier settings", () => {
  const auth0 = getPluginConfigurationAutomationSettings(auth0Environment);
  assert.ok(auth0);
  assert.deepEqual([...auth0.allowedSubjects], [
    "client-one@clients",
    "client-two@clients",
  ]);
  assert.equal(auth0.requiredScope, DEFAULT_PLUGIN_CONFIGURATION_SCOPE);
  assert.deepEqual(auth0.oidc, {
    issuerUrl: "https://tenant.example.test/",
    audience: "https://api.example.test",
    jwksUrl: "https://tenant.example.test/.well-known/jwks.json",
    userInfoUrl: "https://tenant.example.test/userinfo",
  });

  const oidc = getPluginConfigurationAutomationSettings({
    ...oidcEnvironment,
    PLUGIN_CONFIGURATION_AUTOMATION_SCOPE: "plugins:reconcile",
  });
  assert.ok(oidc);
  assert.equal(oidc.requiredScope, "plugins:reconcile");
  assert.equal(oidc.oidc.issuerUrl, oidcEnvironment.OIDC_ISSUER_URL);
});

test("rejects unsafe or incomplete automation configuration", () => {
  assert.throws(
    () =>
      getPluginConfigurationAutomationSettings({
        ...auth0Environment,
        PLUGIN_CONFIGURATION_AUTOMATION_SUBJECTS:
          "client-one@clients,client-one@clients",
      }),
    /unique/
  );
  assert.throws(
    () =>
      getPluginConfigurationAutomationSettings({
        ...auth0Environment,
        PLUGIN_CONFIGURATION_AUTOMATION_SCOPE: "one two",
      }),
    /exactly one/
  );
  assert.throws(
    () =>
      getPluginConfigurationAutomationSettings({
        ...auth0Environment,
        MULTIFORUM_AUTH_PROVIDER: "local-dev",
      }),
    /auth0 or oidc/
  );
  assert.throws(
    () =>
      getPluginConfigurationAutomationSettings({
        ...auth0Environment,
        AUTH0_DOMAIN: "https://tenant.example.test/",
      }),
    /hostname/
  );
});

test("accepts an allowlisted subject with the required scope", async () => {
  const context = contextWithToken();
  let receivedToken = "";
  let receivedAudience = "";
  const authenticated = await authenticatePluginConfigurationAutomation(
    context,
    auth0Environment,
    async (token, configuration) => {
      receivedToken = token;
      receivedAudience = configuration.audience;
      return {
        sub: "client-one@clients",
        scope: "openid plugin-configuration:write",
      };
    }
  );
  assert.equal(authenticated, true);
  assert.equal(receivedToken, "service-token");
  assert.equal(receivedAudience, auth0Environment.AUTH0_AUDIENCE);
  assert.deepEqual(context.pluginConfigurationAutomation, {
    subject: "client-one@clients",
    scope: DEFAULT_PLUGIN_CONFIGURATION_SCOPE,
  });
});

test("accepts an Auth0 permissions claim and caches the request identity", async () => {
  const context = contextWithToken();
  let verifications = 0;
  const verify = async () => {
    verifications += 1;
    return {
      sub: "client-two@clients",
      permissions: ["plugin-configuration:write"],
    };
  };
  assert.equal(
    await authenticatePluginConfigurationAutomation(
      context,
      auth0Environment,
      verify
    ),
    true
  );
  assert.equal(
    await authenticatePluginConfigurationAutomation(
      context,
      auth0Environment,
      verify
    ),
    true
  );
  assert.equal(verifications, 1);
});

test("fails closed for missing, malformed, unauthorized, or invalid tokens", async () => {
  const allowedClaims = async () => ({
    sub: "client-one@clients",
    scope: "plugin-configuration:write",
  });
  assert.equal(
    await authenticatePluginConfigurationAutomation(
      {} as GraphQLContext,
      auth0Environment,
      allowedClaims
    ),
    false
  );
  assert.equal(
    await authenticatePluginConfigurationAutomation(
      ({
        req: { headers: { authorization: "bearer service-token" } },
      }) as unknown as GraphQLContext,
      auth0Environment,
      allowedClaims
    ),
    false
  );
  assert.equal(
    await authenticatePluginConfigurationAutomation(
      contextWithToken(),
      { ...auth0Environment, AUTH0_DOMAIN: "" },
      allowedClaims
    ),
    false
  );
  assert.equal(
    await authenticatePluginConfigurationAutomation(
      contextWithToken(),
      auth0Environment,
      async () => ({
        sub: "unlisted@clients",
        scope: "plugin-configuration:write",
      })
    ),
    false
  );
  assert.equal(
    await authenticatePluginConfigurationAutomation(
      contextWithToken(),
      auth0Environment,
      async () => ({ sub: "client-one@clients", scope: "openid" })
    ),
    false
  );
  assert.equal(
    await authenticatePluginConfigurationAutomation(
      contextWithToken(),
      auth0Environment,
      async () => {
        throw new Error("invalid signature");
      }
    ),
    false
  );
});

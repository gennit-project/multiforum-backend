import assert from "node:assert/strict";
import test from "node:test";

import {
  EXIT,
  getAccessToken,
  parseManifest,
  resolveManifestSecrets,
  runPluginConfigurationCli,
} from "./pluginConfigurationCli.js";

const manifest = {
  apiVersion: "multiforum.gennit.dev/v1alpha1",
  plugins: [{
    pluginId: "security-attachment-scan",
    version: "0.4.0",
    enabled: true,
    secretRefs: [{
      key: "SCAN_SERVICE_API_KEY",
      valueFrom: "env:SCAN_API_KEY",
    }],
  }],
};

const response = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const fixture = (input: {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  file?: string;
}) => {
  let stdout = "";
  let stderr = "";
  return {
    dependencies: {
      env: {
        MULTIFORUM_GRAPHQL_URL: "https://forum.example/graphql",
        MULTIFORUM_ACCESS_TOKEN: "test-access-token",
        ...input.env,
      },
      fetch: input.fetch ?? (async () => response({ data: {} })),
      readFile: async () => input.file ?? JSON.stringify(manifest),
      stdout: {
        write: (chunk: string | Uint8Array) => {
          stdout += chunk.toString();
          return true;
        },
      },
      stderr: {
        write: (chunk: string | Uint8Array) => {
          stderr += chunk.toString();
          return true;
        },
      },
    },
    output: () => ({ stdout, stderr }),
  };
};

test("parses a minimal manifest and rejects malformed input", () => {
  assert.deepEqual(parseManifest(JSON.stringify(manifest)), manifest);
  assert.throws(() => parseManifest("{"), /valid JSON/);
  assert.throws(
    () => parseManifest(JSON.stringify({ plugins: [] })),
    /apiVersion/
  );
  assert.throws(
    () => parseManifest(JSON.stringify({ apiVersion: "v1", plugins: [{}] })),
    /pluginId, version, and enabled/
  );
});

test("resolves unique environment secret references", () => {
  const duplicated = {
    ...manifest,
    plugins: [...manifest.plugins, { ...manifest.plugins[0] }],
  };
  assert.deepEqual(
    resolveManifestSecrets(duplicated, { SCAN_API_KEY: "secret" }),
    [{ valueFrom: "env:SCAN_API_KEY", value: "secret" }]
  );
  assert.throws(
    () => resolveManifestSecrets(manifest, {}),
    /SCAN_API_KEY is required/
  );
  assert.throws(
    () =>
      resolveManifestSecrets({
        ...manifest,
        plugins: [{
          ...manifest.plugins[0],
          secretRefs: [{ key: "x", valueFrom: "vault:x" }],
        }],
      }, {}),
    /supports env:NAME/
  );
  assert.deepEqual(
    resolveManifestSecrets({
      apiVersion: manifest.apiVersion,
      plugins: [{ pluginId: "hello-world", version: "1.0.0", enabled: true }],
    }, {}),
    []
  );
});

test("plan prints drift, authenticates with bearer token, and exits 2", async () => {
  let request: RequestInit | undefined;
  const subject = fixture({
    fetch: async (_url, init) => {
      request = init;
      return response({ data: {
        previewPluginConfigurationReconciliation: {
          apiVersion: manifest.apiVersion,
          inSync: false,
          warnings: [],
          changes: [{
            kind: "ENABLE_PLUGIN",
            path: "plugins.scan",
            message: "Enable it",
            blocked: false,
          }],
        },
      } });
    },
  });
  const code = await runPluginConfigurationCli(
    ["plugin-config", "plan", "--manifest", "manifest.json"],
    subject.dependencies
  );
  assert.equal(code, EXIT.DRIFT);
  assert.match(subject.output().stdout, /drift detected/);
  assert.equal(
    (request?.headers as Record<string, string>).authorization,
    "Bearer test-access-token"
  );
});

test("plan returns success and JSON for in-sync state", async () => {
  const subject = fixture({
    fetch: async () => response({ data: {
      previewPluginConfigurationReconciliation: {
        apiVersion: manifest.apiVersion,
        inSync: true,
        warnings: [],
        changes: [],
      },
    } }),
  });
  const code = await runPluginConfigurationCli(
    ["plugin-config", "plan", "--manifest", "manifest.json", "--json"],
    subject.dependencies
  );
  assert.equal(code, EXIT.SUCCESS);
  assert.match(subject.output().stdout, /"inSync": true/);
});

test("apply resolves secrets at runtime without printing them", async () => {
  let requestBody = "";
  const subject = fixture({
    env: { SCAN_API_KEY: "runtime-secret" },
    fetch: async (_url, init) => {
      requestBody = String(init?.body);
      return response({ data: {
        applyPluginConfiguration: {
          status: "SUCCEEDED",
          message: "done",
          operations: [],
          planAfter: {
            apiVersion: manifest.apiVersion,
            inSync: true,
            warnings: [],
            changes: [],
          },
        },
      } });
    },
  });
  const code = await runPluginConfigurationCli(
    ["plugin-config", "apply", "--manifest", "manifest.json"],
    subject.dependencies
  );
  assert.equal(code, EXIT.SUCCESS);
  assert.match(requestBody, /runtime-secret/);
  assert.doesNotMatch(subject.output().stdout, /runtime-secret/);
});

test("apply fails when the server remains out of sync", async () => {
  const subject = fixture({
    env: { SCAN_API_KEY: "runtime-secret" },
    fetch: async () => response({ data: {
      applyPluginConfiguration: {
        status: "FAILED",
        message: "stopped",
        operations: [],
        planAfter: {
          apiVersion: manifest.apiVersion,
          inSync: false,
          warnings: [],
          changes: [],
        },
      },
    } }),
  });
  assert.equal(
    await runPluginConfigurationCli(
      ["plugin-config", "apply", "--manifest", "manifest.json"],
      subject.dependencies
    ),
    EXIT.ERROR
  );
});

test("obtains a scoped client-credentials token when no token is supplied", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const token = await getAccessToken(
    {
      MULTIFORUM_OAUTH_TOKEN_URL: "https://identity.example/oauth/token",
      MULTIFORUM_OAUTH_CLIENT_ID: "ci-client",
      MULTIFORUM_OAUTH_CLIENT_SECRET: "client-secret",
      MULTIFORUM_OAUTH_AUDIENCE: "https://api.example",
    },
    async (url, init) => {
      requests.push({ url: String(url), init });
      return response({
        access_token: "service-access-token",
        token_type: "Bearer",
      });
    }
  );
  assert.equal(token, "service-access-token");
  assert.equal(requests[0].url, "https://identity.example/oauth/token");
  const body = requests[0].init?.body;
  assert.ok(body instanceof URLSearchParams);
  assert.equal(body.get("grant_type"), "client_credentials");
  assert.equal(body.get("client_id"), "ci-client");
  assert.equal(body.get("client_secret"), "client-secret");
  assert.equal(body.get("audience"), "https://api.example");
  assert.equal(body.get("scope"), "plugin-configuration:write");
});

test("uses the client-credentials token for the GraphQL request", async () => {
  const authorizations: string[] = [];
  const subject = fixture({
    env: {
      MULTIFORUM_ACCESS_TOKEN: "",
      MULTIFORUM_OAUTH_TOKEN_URL: "https://identity.example/oauth/token",
      MULTIFORUM_OAUTH_CLIENT_ID: "ci-client",
      MULTIFORUM_OAUTH_CLIENT_SECRET: "client-secret",
      MULTIFORUM_OAUTH_AUDIENCE: "https://api.example",
      MULTIFORUM_OAUTH_SCOPE: "plugins:reconcile",
    },
    fetch: async (url, init) => {
      if (String(url).includes("/oauth/token")) {
        const body = init?.body;
        assert.ok(body instanceof URLSearchParams);
        assert.equal(body.get("scope"), "plugins:reconcile");
        return response({ access_token: "m2m-token", token_type: "bearer" });
      }
      authorizations.push(
        (init?.headers as Record<string, string>).authorization
      );
      return response({ data: {
        previewPluginConfigurationReconciliation: {
          apiVersion: manifest.apiVersion,
          inSync: true,
          warnings: [],
          changes: [],
        },
      } });
    },
  });
  assert.equal(
    await runPluginConfigurationCli(
      ["plugin-config", "plan", "--manifest", "manifest.json"],
      subject.dependencies
    ),
    EXIT.SUCCESS
  );
  assert.deepEqual(authorizations, ["Bearer m2m-token"]);
  assert.doesNotMatch(subject.output().stdout, /m2m-token|client-secret/);
});

test("reports safe client-credentials failures", async () => {
  const environment = {
    MULTIFORUM_OAUTH_TOKEN_URL: "https://identity.example/oauth/token",
    MULTIFORUM_OAUTH_CLIENT_ID: "ci-client",
    MULTIFORUM_OAUTH_CLIENT_SECRET: "client-secret",
    MULTIFORUM_OAUTH_AUDIENCE: "https://api.example",
  };
  await assert.rejects(
    getAccessToken(environment, async () => response({}, 401)),
    /HTTP 401/
  );
  await assert.rejects(
    getAccessToken(environment, async () => new Response("not-json")),
    /invalid JSON/
  );
  await assert.rejects(
    getAccessToken(environment, async () => response({ token_type: "Bearer" })),
    /access token/
  );
  await assert.rejects(
    getAccessToken(
      environment,
      async () => response({ access_token: "secret", token_type: "MAC" })
    ),
    /bearer token/
  );
  await assert.rejects(
    getAccessToken(environment, async () => {
      throw new Error("offline");
    }),
    /Could not reach OAuth token endpoint: offline/
  );
  await assert.rejects(
    getAccessToken(
      { ...environment, MULTIFORUM_OAUTH_TOKEN_URL: "http://identity.example/token" },
      async () => response({})
    ),
    /must use HTTPS/
  );
});

test("returns safe errors for CLI, HTTP, GraphQL, data, and network failures", async () => {
  const usage = fixture({});
  assert.equal(await runPluginConfigurationCli([], usage.dependencies), EXIT.ERROR);
  assert.match(usage.output().stderr, /Usage/);

  const unknown = fixture({});
  assert.equal(
    await runPluginConfigurationCli(
      ["plugin-config", "plan", "--manifest", "manifest.json", "--wat"],
      unknown.dependencies
    ),
    EXIT.ERROR
  );
  assert.match(unknown.output().stderr, /Unknown argument/);

  const missingEndpoint = fixture({
    env: { MULTIFORUM_GRAPHQL_URL: "" },
  });
  assert.equal(
    await runPluginConfigurationCli(
      ["plugin-config", "plan", "--manifest", "manifest.json"],
      missingEndpoint.dependencies
    ),
    EXIT.ERROR
  );
  assert.match(missingEndpoint.output().stderr, /GRAPHQL_URL/);

  const missingToken = fixture({
    env: { MULTIFORUM_ACCESS_TOKEN: "" },
  });
  assert.equal(
    await runPluginConfigurationCli(
      [
        "plugin-config",
        "plan",
        "--manifest",
        "manifest.json",
        "--endpoint",
        "https://override.example/graphql",
      ],
      missingToken.dependencies
    ),
    EXIT.ERROR
  );
  assert.match(missingToken.output().stderr, /ACCESS_TOKEN/);

  const cases: Array<[typeof globalThis.fetch, RegExp]> = [
    [async () => response({}, 503), /HTTP 503/],
    [async () => response({ errors: [{ message: "denied" }] }), /denied/],
    [async () => new Response("not-json"), /invalid JSON/],
    [async () => response({}), /did not contain data/],
    [async () => { throw new Error("offline"); }, /Could not reach Multiforum: offline/],
  ];
  for (const [fetch, expected] of cases) {
    const subject = fixture({ fetch });
    assert.equal(
      await runPluginConfigurationCli(
        ["plugin-config", "plan", "--manifest", "manifest.json"],
        subject.dependencies
      ),
      EXIT.ERROR
    );
    assert.match(subject.output().stderr, expected);
    assert.doesNotMatch(subject.output().stderr, /test-access-token/);
  }
});

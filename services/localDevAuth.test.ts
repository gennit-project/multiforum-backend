import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import {
  assertAuthenticationConfiguration,
  createLocalDevTokenHandler,
  getAuthenticationProvider,
  getLocalDevAuthMissingVariables,
  isLocalDevAuthConfigured,
  issueLocalDevToken,
  verifyLocalDevToken,
} from "./localDevAuth.js";

const localEnv = {
  NODE_ENV: "development",
  MULTIFORUM_AUTH_PROVIDER: "local-dev",
  MULTIFORUM_BOOTSTRAP_EMAIL: "admin@example.test",
  MULTIFORUM_BOOTSTRAP_USERNAME: "admin",
  MULTIFORUM_BOOTSTRAP_PASSWORD: "local-password",
  SUPERADMIN_EMAIL: "admin@example.test",
};

const withProcessEnvironment = <T>(
  values: NodeJS.ProcessEnv,
  callback: () => T
): T => {
  const names = ["MULTIFORUM_AUTH_PROVIDER", ...Object.keys(localEnv)];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]])
  );
  for (const name of names) {
    delete process.env[name];
  }
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
};

test("keeps Auth0 as the backwards-compatible default provider", () => {
  assert.equal(getAuthenticationProvider({}), "auth0");
  assert.equal(getAuthenticationProvider({ MULTIFORUM_AUTH_PROVIDER: "AUTH0" }), "auth0");
  assert.equal(getAuthenticationProvider({ MULTIFORUM_AUTH_PROVIDER: "OIDC" }), "oidc");
});

test("rejects unknown authentication providers", () => {
  assert.throws(
    () => getAuthenticationProvider({ MULTIFORUM_AUTH_PROVIDER: "passwords" }),
    /Unsupported MULTIFORUM_AUTH_PROVIDER/
  );
});

test("reports every missing local development setting", () => {
  assert.deepEqual(getLocalDevAuthMissingVariables({}), [
    "NODE_ENV",
    "MULTIFORUM_BOOTSTRAP_EMAIL",
    "MULTIFORUM_BOOTSTRAP_USERNAME",
    "MULTIFORUM_BOOTSTRAP_PASSWORD",
    "SUPERADMIN_EMAIL",
  ]);
});

test("uses process.env when provider helpers omit an explicit environment", () => {
  withProcessEnvironment(localEnv, () => {
    assert.equal(getAuthenticationProvider(), "local-dev");
    assert.deepEqual(getLocalDevAuthMissingVariables(), []);
    assert.doesNotThrow(() => assertAuthenticationConfiguration());
    assert.equal(isLocalDevAuthConfigured(), true);

    const token = issueLocalDevToken("local-password");
    assert.ok(token);
    assert.deepEqual(verifyLocalDevToken(token), {
      email: "admin@example.test",
      username: "admin",
    });
  });
});

test("accepts the default Auth0 provider without requiring local settings", () => {
  assert.doesNotThrow(() => assertAuthenticationConfiguration({}));
  assert.equal(isLocalDevAuthConfigured({}), false);
});

test("validates generic OIDC settings at startup", () => {
  assert.throws(
    () => assertAuthenticationConfiguration({ MULTIFORUM_AUTH_PROVIDER: "oidc" }),
    /OIDC_ISSUER_URL/
  );
  assert.doesNotThrow(() =>
    assertAuthenticationConfiguration({
      MULTIFORUM_AUTH_PROVIDER: "oidc",
      OIDC_ISSUER_URL: "https://identity.example.test/realms/multiforum",
      OIDC_AUDIENCE: "multiforum-api",
      OIDC_JWKS_URL: "https://identity.example.test/realms/multiforum/certs",
      OIDC_USERINFO_URL:
        "https://identity.example.test/realms/multiforum/userinfo",
    })
  );
});

test("names missing settings when an enabled local provider is incomplete", () => {
  assert.throws(
    () => assertAuthenticationConfiguration({
      ...localEnv,
      MULTIFORUM_BOOTSTRAP_PASSWORD: "",
    }),
    /MULTIFORUM_BOOTSTRAP_PASSWORD/
  );
});

test("refuses local development authentication in production", () => {
  assert.throws(
    () => assertAuthenticationConfiguration({ ...localEnv, NODE_ENV: "production" }),
    /cannot run in production/
  );
  assert.equal(
    isLocalDevAuthConfigured({ ...localEnv, NODE_ENV: "production" }),
    false
  );
});

test("requires development mode to be explicit", () => {
  assert.throws(
    () => assertAuthenticationConfiguration({ ...localEnv, NODE_ENV: undefined }),
    /requires NODE_ENV=development/
  );
});

test("requires the bootstrap identity to remain the break-glass root", () => {
  assert.throws(
    () => assertAuthenticationConfiguration({
      ...localEnv,
      SUPERADMIN_EMAIL: "someone-else@example.test",
    }),
    /must match/
  );
});

test("requires a non-trivial local password", () => {
  assert.throws(
    () => assertAuthenticationConfiguration({
      ...localEnv,
      MULTIFORUM_BOOTSTRAP_PASSWORD: "too-short",
    }),
    /at least 12 characters/
  );
});

test("validates the configured email and username", () => {
  assert.throws(
    () => assertAuthenticationConfiguration({
      ...localEnv,
      MULTIFORUM_BOOTSTRAP_EMAIL: "not-an-email",
      SUPERADMIN_EMAIL: "not-an-email",
    }),
    /valid email address/
  );
  assert.throws(
    () => assertAuthenticationConfiguration({
      ...localEnv,
      MULTIFORUM_BOOTSTRAP_USERNAME: "invalid username",
    }),
    /letters, numbers, or underscores/
  );
});

test("issues and verifies a short-lived token for the configured identity", () => {
  const token = issueLocalDevToken("local-password", localEnv);
  assert.ok(token);
  assert.deepEqual(verifyLocalDevToken(token, localEnv), {
    email: "admin@example.test",
    username: "admin",
  });

  const decoded = jwt.decode(token) as jwt.JwtPayload;
  assert.equal(decoded.iss, "multiforum-local-dev");
  assert.equal(decoded.aud, "multiforum-backend");
  assert.equal(decoded.sub, "admin");
  assert.ok((decoded.exp ?? 0) > (decoded.iat ?? 0));
});

test("does not issue a token for missing or incorrect passwords", () => {
  assert.equal(issueLocalDevToken(undefined, localEnv), null);
  assert.equal(issueLocalDevToken("wrong-password", localEnv), null);
});

test("rejects tokens signed by a different secret", () => {
  const token = issueLocalDevToken("local-password", localEnv);
  assert.ok(token);
  assert.throws(() => verifyLocalDevToken(token, {
    ...localEnv,
    MULTIFORUM_BOOTSTRAP_PASSWORD: "different-password",
  }));
});

test("rejects a correctly signed token for a different identity", () => {
  const token = jwt.sign(
    {
      email: "attacker@example.test",
      username: "attacker",
      email_verified: true,
    },
    localEnv.MULTIFORUM_BOOTSTRAP_PASSWORD,
    {
      algorithm: "HS256",
      audience: "multiforum-backend",
      issuer: "multiforum-local-dev",
      subject: "attacker",
    }
  );

  assert.throws(() => verifyLocalDevToken(token, localEnv), /does not match/);
});

test("rejects expired tokens", () => {
  const token = jwt.sign(
    {
      email: localEnv.MULTIFORUM_BOOTSTRAP_EMAIL,
      username: localEnv.MULTIFORUM_BOOTSTRAP_USERNAME,
      email_verified: true,
    },
    localEnv.MULTIFORUM_BOOTSTRAP_PASSWORD,
    {
      algorithm: "HS256",
      audience: "multiforum-backend",
      issuer: "multiforum-local-dev",
      subject: localEnv.MULTIFORUM_BOOTSTRAP_USERNAME,
      expiresIn: -1,
    }
  );

  assert.throws(
    () => verifyLocalDevToken(token, localEnv),
    (error: unknown) => error instanceof Error && error.name === "TokenExpiredError"
  );
});

test("rejects tokens signed with an algorithm outside the HS256 allow-list", () => {
  const token = jwt.sign(
    {
      email: localEnv.MULTIFORUM_BOOTSTRAP_EMAIL,
      username: localEnv.MULTIFORUM_BOOTSTRAP_USERNAME,
      email_verified: true,
    },
    localEnv.MULTIFORUM_BOOTSTRAP_PASSWORD,
    {
      algorithm: "HS384",
      audience: "multiforum-backend",
      issuer: "multiforum-local-dev",
      subject: localEnv.MULTIFORUM_BOOTSTRAP_USERNAME,
    }
  );

  assert.throws(() => verifyLocalDevToken(token, localEnv), /invalid algorithm/);
});

type ResponseResult = {
  status?: number;
  body?: unknown;
  headers: Record<string, string>;
};

const invokeHandler = (env: NodeJS.ProcessEnv, body: unknown) => {
  const result: ResponseResult = { headers: {} };
  const response = {
    setHeader: (name: string, value: string) => {
      result.headers[name] = value;
    },
    status: (status: number) => {
      result.status = status;
      return response;
    },
    json: (responseBody: unknown) => {
      result.body = responseBody;
      return response;
    },
  };
  createLocalDevTokenHandler(env)(
    { body } as never,
    response as never,
    (() => {}) as never
  );
  return result;
};

test("hides the token endpoint unless local auth is enabled", () => {
  assert.deepEqual(invokeHandler({}, { password: "anything" }), {
    status: 404,
    body: { error: "Not found" },
    headers: { "Cache-Control": "no-store" },
  });
});

test("returns an authorization failure without echoing credentials", () => {
  assert.deepEqual(invokeHandler(localEnv, { password: "wrong-password" }), {
    status: 401,
    body: { error: "Invalid credentials" },
    headers: { "Cache-Control": "no-store" },
  });
});

test("rejects a token request without a JSON body", () => {
  assert.deepEqual(invokeHandler(localEnv, undefined), {
    status: 401,
    body: { error: "Invalid credentials" },
    headers: { "Cache-Control": "no-store" },
  });
});

test("returns a bearer token without allowing it to be cached", () => {
  const result = invokeHandler(localEnv, { password: "local-password" });
  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal((result.body as { tokenType: string }).tokenType, "Bearer");
  assert.deepEqual(
    verifyLocalDevToken(
      (result.body as { accessToken: string }).accessToken,
      localEnv
    ),
    { email: "admin@example.test", username: "admin" }
  );
});

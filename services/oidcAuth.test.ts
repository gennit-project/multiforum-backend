import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import jwt from "jsonwebtoken";
import {
  getOidcAuthMissingVariables,
  getOidcConfiguration,
  isOidcAuthConfigured,
  verifyOidcToken,
} from "./oidcAuth.js";

const completeEnvironment = {
  OIDC_ISSUER_URL: "https://identity.example.test/realms/multiforum",
  OIDC_AUDIENCE: "multiforum-api",
  OIDC_JWKS_URL:
    "https://identity.example.test/realms/multiforum/protocol/openid-connect/certs",
  OIDC_USERINFO_URL:
    "https://identity.example.test/realms/multiforum/protocol/openid-connect/userinfo",
};

test("reports and validates the generic OIDC configuration", () => {
  assert.deepEqual(getOidcAuthMissingVariables({}), [
    "OIDC_ISSUER_URL",
    "OIDC_AUDIENCE",
    "OIDC_JWKS_URL",
    "OIDC_USERINFO_URL",
  ]);
  assert.deepEqual(getOidcConfiguration(completeEnvironment), {
    issuerUrl: completeEnvironment.OIDC_ISSUER_URL,
    audience: completeEnvironment.OIDC_AUDIENCE,
    jwksUrl: completeEnvironment.OIDC_JWKS_URL,
    userInfoUrl: completeEnvironment.OIDC_USERINFO_URL,
  });
  assert.equal(isOidcAuthConfigured(completeEnvironment), true);
  assert.equal(
    isOidcAuthConfigured({ ...completeEnvironment, OIDC_AUDIENCE: "" }),
    false
  );
  assert.throws(
    () =>
      getOidcConfiguration({
        ...completeEnvironment,
        OIDC_ISSUER_URL: "http://identity.example.test/realms/multiforum",
      }),
    /must use HTTPS/
  );
  assert.throws(
    () =>
      getOidcConfiguration({
        ...completeEnvironment,
        OIDC_JWKS_URL: "not a URL",
      }),
    /absolute URL/
  );
  assert.throws(
    () =>
      getOidcConfiguration({
        ...completeEnvironment,
        OIDC_USERINFO_URL: "https://user:secret@identity.example.test/userinfo",
      }),
    /must not contain credentials/
  );
});

test("verifies issuer, audience, signature, subject, and UserInfo identity", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const publicJwk = publicKey.export({ format: "jwk" });
  const keyId = "oidc-test-key";
  let userInfo = {
    sub: "identity-user-1",
    email: "member@example.test",
    email_verified: true,
  };
  let userInfoRequests = 0;

  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/jwks") {
      response.end(
        JSON.stringify({ keys: [{ ...publicJwk, kid: keyId, use: "sig", alg: "RS256" }] })
      );
      return;
    }
    if (request.url === "/userinfo") {
      userInfoRequests += 1;
      if (!request.headers.authorization?.startsWith("Bearer ")) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: "missing_token" }));
        return;
      }
      response.end(JSON.stringify(userInfo));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const issuer = `http://127.0.0.1:${address.port}`;
    const env = {
      NODE_ENV: "test",
      OIDC_ISSUER_URL: issuer,
      OIDC_AUDIENCE: "multiforum-api",
      OIDC_JWKS_URL: `${issuer}/jwks`,
      OIDC_USERINFO_URL: `${issuer}/userinfo`,
    };
    const sign = (overrides: jwt.SignOptions = {}) =>
      jwt.sign({}, privateKey, {
        algorithm: "RS256",
        keyid: keyId,
        issuer,
        audience: "multiforum-api",
        subject: "identity-user-1",
        jwtid: randomUUID(),
        expiresIn: "5m",
        ...overrides,
      });

    const token = sign();
    assert.deepEqual(await verifyOidcToken(token, env), {
      email: "member@example.test",
      subject: "identity-user-1",
    });
    assert.deepEqual(await verifyOidcToken(token, env), {
      email: "member@example.test",
      subject: "identity-user-1",
    });
    assert.equal(userInfoRequests, 1);

    await assert.rejects(
      verifyOidcToken(sign({ issuer: `${issuer}/other` }), env),
      /issuer invalid/
    );
    await assert.rejects(
      verifyOidcToken(sign({ audience: "another-api" }), env),
      /audience invalid/
    );
    const tokenWithoutKeyId = jwt.sign({}, privateKey, {
      algorithm: "RS256",
      issuer,
      audience: "multiforum-api",
      subject: "identity-user-1",
      expiresIn: "5m",
    });
    await assert.rejects(verifyOidcToken(tokenWithoutKeyId, env), /missing 'kid'/);
    await assert.rejects(
      verifyOidcToken(sign({ keyid: "unknown-key" }), env),
      /Unable to find a signing key/
    );
    const tokenWithoutSubject = jwt.sign({}, privateKey, {
      algorithm: "RS256",
      keyid: keyId,
      issuer,
      audience: "multiforum-api",
      expiresIn: "5m",
    });
    await assert.rejects(verifyOidcToken(tokenWithoutSubject, env), /subject/);

    userInfo = { ...userInfo, sub: "another-user" };
    await assert.rejects(
      verifyOidcToken(sign(), env),
      /subject does not match/
    );
    userInfo = { ...userInfo, sub: "identity-user-1", email_verified: false };
    await assert.rejects(verifyOidcToken(sign(), env), /has not verified/);
    userInfo = { ...userInfo, email_verified: true, email: "" };
    await assert.rejects(verifyOidcToken(sign(), env), /email address/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

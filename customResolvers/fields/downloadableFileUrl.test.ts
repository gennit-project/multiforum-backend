import test from "node:test";
import assert from "node:assert/strict";
import { createDownloadableFileUrlResolver } from "./downloadableFileUrl.js";

const baseContext = {
  ogm: {},
  req: {
    headers: {},
  },
};

test("returns an empty string when the request is anonymous", async () => {
  const resolver = createDownloadableFileUrlResolver(async () => ({
    username: null,
    email: null,
    email_verified: false,
    data: null,
  }));

  const result = await resolver(
    { url: "https://example.com/file.zip" },
    {},
    { ...baseContext }
  );

  assert.equal(result, "");
});

test("returns an empty string when the request has a JWT error", async () => {
  const resolver = createDownloadableFileUrlResolver(async () => {
    throw new Error("should not be called");
  });

  const result = await resolver(
    { url: "https://example.com/file.zip" },
    {},
    { ...baseContext, jwtError: new Error("expired") }
  );

  assert.equal(result, "");
});

test("returns the file URL for authenticated requests", async () => {
  const resolver = createDownloadableFileUrlResolver(async () => ({
    username: "cluse",
    email: "cluse@example.com",
    email_verified: true,
    data: null,
  }));

  const result = await resolver(
    { url: "https://example.com/file.zip" },
    {},
    { ...baseContext }
  );

  assert.equal(result, "https://example.com/file.zip");
});

test("reuses context.user when it is already available", async () => {
  let callCount = 0;
  const resolver = createDownloadableFileUrlResolver(async () => {
    callCount += 1;
    return {
      username: "cluse",
      email: "cluse@example.com",
      email_verified: true,
      data: null,
    };
  });

  const result = await resolver(
    { url: "https://example.com/file.zip" },
    {},
    {
      ...baseContext,
      user: {
        username: "cluse",
        email: "cluse@example.com",
        email_verified: true,
        data: null,
      },
    }
  );

  assert.equal(result, "https://example.com/file.zip");
  assert.equal(callCount, 0);
});

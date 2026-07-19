import test from "node:test";
import assert from "node:assert/strict";
import { createDownloadableFileUrlResolver } from "./downloadableFileUrl.js";

type ResolverContext = Parameters<
  ReturnType<typeof createDownloadableFileUrlResolver>
>[2];

const buildContext = (file: Record<string, unknown> | null = {
  url: "https://example.com/file.zip",
  scanStatus: "CLEAN",
  uploadedByUsername: "alice",
  Discussion: { Author: { username: "alice" } },
}) => ({
  ogm: {
    model: () => ({
      find: async () => file ? [file] : [],
    }),
  },
  req: {
    headers: {},
  },
});

test("returns an empty string when the request is anonymous", async () => {
  const resolver = createDownloadableFileUrlResolver(async () => ({
    username: null,
    email: null,
    email_verified: false,
    data: null,
  }));

  const result = await resolver(
    { id: "file-1", url: "https://example.com/file.zip" },
    {},
    buildContext() as unknown as ResolverContext
  );

  assert.equal(result, "");
});

test("returns an empty string when the request has a JWT error", async () => {
  const resolver = createDownloadableFileUrlResolver(async () => {
    throw new Error("should not be called");
  });

  const result = await resolver(
    { id: "file-1", url: "https://example.com/file.zip" },
    {},
    { ...buildContext(), jwtError: new Error("expired") } as unknown as ResolverContext
  );

  assert.equal(result, "");
});

test("withholds the stored file URL from regular authenticated requests", async () => {
  const resolver = createDownloadableFileUrlResolver(async () => ({
    username: "cluse",
    email: "cluse@example.com",
    email_verified: true,
    data: null,
  }));

  const result = await resolver(
    { id: "file-1", url: "https://example.com/file.zip" },
    {},
    buildContext() as unknown as ResolverContext
  );

  assert.equal(result, "");
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
    { id: "file-1", url: "https://example.com/file.zip" },
    {},
    {
      ...buildContext(),
      user: {
        username: "cluse",
        email: "cluse@example.com",
        email_verified: true,
        data: null,
      },
    } as unknown as ResolverContext
  );

  assert.equal(result, "");
  assert.equal(callCount, 0);
});

test("withholds a pending file URL from a regular authenticated user", async () => {
  const resolver = createDownloadableFileUrlResolver(
    async () => ({
      username: "bob",
      email: "bob@example.com",
      email_verified: true,
      data: null,
    }),
    async () => false
  );

  const result = await resolver(
    { id: "file-1", url: "https://example.com/file.zip" },
    {},
    buildContext({
      url: "https://example.com/file.zip",
      scanStatus: "PENDING",
      uploadedByUsername: "alice",
      Discussion: { Author: { username: "alice" } },
    }) as unknown as ResolverContext
  );

  assert.equal(result, "");
});

test("allows the creator to access a blocked file for review", async () => {
  const resolver = createDownloadableFileUrlResolver(async () => ({
    username: "alice",
    email: "alice@example.com",
    email_verified: true,
    data: null,
  }));

  const result = await resolver(
    { id: "file-1", url: "https://example.com/file.zip" },
    {},
    buildContext({
      url: "https://example.com/file.zip",
      scanStatus: "INFECTED",
      uploadedByUsername: "alice",
      Discussion: { Author: { username: "alice" } },
    }) as unknown as ResolverContext
  );

  assert.equal(result, "https://example.com/file.zip");
});

test("allows an authorized moderator to access a failed file for review", async () => {
  const resolver = createDownloadableFileUrlResolver(
    async () => ({
      username: "moderator",
      email: "mod@example.com",
      email_verified: true,
      data: null,
    }),
    async () => true
  );

  const result = await resolver(
    { id: "file-1", url: "https://example.com/file.zip" },
    {},
    buildContext({
      url: "https://example.com/file.zip",
      scanStatus: "FAILED",
      uploadedByUsername: "alice",
      Discussion: { Author: { username: "alice" } },
    }) as unknown as ResolverContext
  );

  assert.equal(result, "https://example.com/file.zip");
});

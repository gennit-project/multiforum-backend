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
  downloadableFileRepository: {
    findUrlAccess: async () => file ? {
      uploadedByUsername: file.uploadedByUsername ?? null,
      discussionAuthorUsername:
        (file.Discussion as { Author?: { username?: string } })?.Author?.username ?? null,
    } : null,
  },
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

const authenticated = (username: string) => ({
  username, email: null, email_verified: false, data: null,
});

test("authorizes the discussion author and preserves parent URL or empty fallback", async () => {
  const resolver = createDownloadableFileUrlResolver(
    async () => authenticated("author"),
    async () => { throw new Error("owners bypass moderator checks"); }
  );
  const context = () => buildContext({
    url: "https://example.test/stored.zip",
    uploadedByUsername: "uploader",
    Discussion: { Author: { username: "author" } },
  }) as unknown as ResolverContext;
  assert.equal(
    await resolver({ id: "file", url: "https://example.test/parent.zip" }, {}, context()),
    "https://example.test/parent.zip"
  );
  assert.equal(await resolver({ id: "file" }, {}, context()), "");
});

test("missing id and missing file fail closed without checking moderator permissions", async () => {
  const resolver = createDownloadableFileUrlResolver(
    async () => authenticated("alice"),
    async () => { throw new Error("must not check permissions"); }
  );
  const context = buildContext(null) as unknown as ResolverContext;
  assert.equal(await resolver({ id: "missing", url: "private" }, {}, context), "");
  context.downloadableFileRepository = {
    findUrlAccess: async () => { throw new Error("must not read without an id"); },
  };
  assert.equal(await resolver({ url: "private" }, {}, context), "");
});

test("only literal true grants moderator access", async () => {
  for (const permission of [false, new Error("denied")]) {
    const resolver = createDownloadableFileUrlResolver(
      async () => authenticated("moderator"),
      async () => permission
    );
    assert.equal(await resolver(
      { id: "file", url: "private" }, {}, buildContext() as unknown as ResolverContext
    ), "");
  }
});

test("lookup errors propagate instead of using the parent URL", async () => {
  const context = buildContext() as unknown as ResolverContext;
  context.downloadableFileRepository = {
    findUrlAccess: async () => { throw new Error("database unavailable"); },
  };
  const resolver = createDownloadableFileUrlResolver(async () => authenticated("alice"));
  await assert.rejects(
    resolver({ id: "file", url: "private" }, {}, context), /database unavailable/
  );
});

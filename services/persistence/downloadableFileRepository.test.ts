import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import { makeResult } from "../../tests/fixtures/neo4j.js";
import {
  createDownloadableFileRepository,
  FIND_DOWNLOADABLE_FILE_URL_ACCESS_QUERY,
  FIND_DOWNLOADABLE_FILE_ATTACHMENT_METADATA_QUERY,
  resolveDownloadableFileRepository,
} from "./downloadableFileRepository.js";

const setup = (rows: Record<string, unknown>[] = [], failure?: Error) => {
  const configs: unknown[] = [];
  const calls: unknown[] = [];
  const bookmarkManager = neo4j.bookmarkManager();
  let closed = 0;
  let transactions = 0;
  const driver = {
    executeQueryBookmarkManager: bookmarkManager,
    session(config: unknown) {
      configs.push(config);
      return {
        async executeRead(work: (tx: unknown) => Promise<unknown>) {
          transactions += 1;
          return work({
            async run(query: string, parameters: unknown) {
              calls.push({ query, parameters });
              if (failure) throw failure;
              return makeResult(rows);
            },
          });
        },
        async close() { closed += 1; },
      };
    },
  } as unknown as Driver;
  return {
    driver, configs, calls, bookmarkManager,
    counts: () => ({ closed, transactions }),
  };
};

test("access lookup uses a parameterized existing managed read routing and shared bookmarks", async () => {
  const state = setup([{
    scanStatus: "CLEAN", uploadedByUsername: "uploader", author: { username: "author" },
  }]);
  const repository = createDownloadableFileRepository(state.driver, "downloads");
  const id = "file' quoted";
  assert.deepEqual(await repository.findUrlAccess(id), {
    uploadedByUsername: "uploader", discussionAuthorUsername: "author",
  });
  assert.deepEqual(state.configs, [{
    database: "downloads", defaultAccessMode: neo4j.session.READ,
    bookmarkManager: state.bookmarkManager,
  }]);
  assert.deepEqual(state.calls, [{
    query: FIND_DOWNLOADABLE_FILE_URL_ACCESS_QUERY, parameters: { id },
  }]);
  assert.deepEqual(state.counts(), { closed: 1, transactions: 1 });
});

test("missing files and nullable ownership are explicit", async () => {
  assert.equal(await createDownloadableFileRepository(setup().driver).findUrlAccess("none"), null);
  const state = setup([{ scanStatus: "PENDING", uploadedByUsername: null, author: null }]);
  assert.deepEqual(await createDownloadableFileRepository(state.driver).findUrlAccess("orphan"), {
    uploadedByUsername: null, discussionAuthorUsername: null,
  });
});

test("database errors propagate and close the session", async () => {
  const state = setup([], new Error("lookup failed"));
  await assert.rejects(
    createDownloadableFileRepository(state.driver).findUrlAccess("file"), /lookup failed/
  );
  assert.equal(state.counts().closed, 1);
});

test("invalid non-null projection values still fail closed and close the session", async () => {
  for (const row of [
    { scanStatus: null },
    { scanStatus: "INVALID" },
    { scanStatus: "CLEAN", author: { username: null } },
    { scanStatus: "CLEAN", uploadedByUsername: [] },
  ]) {
    const state = setup([row]);
    await assert.rejects(createDownloadableFileRepository(state.driver).findUrlAccess("file"));
    assert.equal(state.counts().closed, 1);
  }
});

test("an injected repository is used unchanged", () => {
  const injected = { findUrlAccess: async () => null, findAttachmentMetadata: async () => null };
  assert.equal(resolveDownloadableFileRepository({
    driver: {} as Driver, downloadableFileRepository: injected,
  }), injected);
});

test("metadata lookup retains read routing, parameters, and projection independent of access fields", async () => {
  const state = setup([{ id: "file", fileName: "" }]);
  const repository = createDownloadableFileRepository(state.driver, "downloads");
  assert.deepEqual(await repository.findAttachmentMetadata("file"), { id: "file", fileName: "" });
  assert.deepEqual(state.calls, [{
    query: FIND_DOWNLOADABLE_FILE_ATTACHMENT_METADATA_QUERY, parameters: { id: "file" },
  }]);
  assert.deepEqual(state.configs, [{
    database: "downloads", defaultAccessMode: neo4j.session.READ,
    bookmarkManager: state.bookmarkManager,
  }]);
  assert.deepEqual(state.counts(), { closed: 1, transactions: 1 });
  assert.equal(
    await createDownloadableFileRepository(setup().driver).findAttachmentMetadata("missing"), null
  );
});

test("metadata query and serialization failures propagate and close the session", async () => {
  for (const state of [
    setup([], new Error("database unavailable")),
    setup([{ id: "file", fileName: null }]),
    setup([{ id: "file", fileName: [] }]),
  ]) {
    await assert.rejects(createDownloadableFileRepository(state.driver).findAttachmentMetadata("file"));
    assert.equal(state.counts().closed, 1);
  }
});

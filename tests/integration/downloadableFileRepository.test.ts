import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import {
  executeGeneratedOperation,
  registerGeneratedSchema,
} from "../../services/persistence/generatedSchemaOperations.js";
import { createDownloadableFileUrlResolver } from "../../customResolvers/fields/downloadableFileUrl.js";
import type { GraphQLContext } from "../../types/context.js";
import { validateDiscussionDownloadPreferences } from "../../rules/validation/discussionIsValid.js";
import { createDownloadableFileRepository } from "../../services/persistence/downloadableFileRepository.js";
import {
  installRequestScopedBookmarks, runWithRequestBookmarks, getRequestBookmarkManager,
} from "../../services/requestScopedBookmarks.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = installRequestScopedBookmarks(await startNeo4j());
  const app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({
    typeDefs,
    driver,
    resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  registerGeneratedSchema(driver, await neoSchema.getSchema());
}, { timeout: 240_000 });

beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());

const seedFile = async () => {
  await driver.executeQuery(`
    CREATE (file:DownloadableFile {
      id: "file", url: "https://example.test/stored.zip", scanStatus: "CLEAN",
      uploadedByUsername: "uploader", fileName: "stored.zip"
    })
    CREATE (author:User {username: "author"})
    CREATE (discussion:Discussion {id: "discussion"})
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(file)
    CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
  `);
};

// The production path's file-access read now runs through the registered
// generated schema, which applies the same authorization the shared-schema OGM
// did (anonymous URL blanking, age-gate and sensitive-discussion filtering).
type FileAccessRecord = {
  url: string | null;
  scanStatus: string | null;
  uploadedByUsername: string | null;
  Discussion: { Author: { username: string } | null } | null;
};

const FIND_FILE_ACCESS = `query FindFileAccess($where: DownloadableFileWhere) {
  downloadableFiles(where: $where) {
    url scanStatus uploadedByUsername Discussion { Author { username } }
  }
}`;

const findFileAccess = async (): Promise<FileAccessRecord[]> =>
  (await executeGeneratedOperation<{ downloadableFiles: FileAccessRecord[] }>(
    driver,
    FIND_FILE_ACCESS,
    { where: { id: "file" } }
  )).downloadableFiles;

test("production OGM resolves the selected URL anonymously; standalone OGM returns storage data", async () => {
  await seedFile();
  const records = await findFileAccess();
  assert.deepEqual(JSON.parse(JSON.stringify(records)), [{
    url: "",
    scanStatus: "CLEAN",
    uploadedByUsername: "uploader",
    Discussion: { Author: { username: "author" } },
  }]);
});

test("the existing URL resolver returns parent URL in production but stored URL with standalone OGM", async (t) => {
  await seedFile();
  const resolveUrl = createDownloadableFileUrlResolver(
    async () => { throw new Error("preloaded identity must be reused"); },
    async () => false
  );
  const context = {
    driver,
    user: {
      username: "uploader", email: null, email_verified: false, data: null,
    },
  } as GraphQLContext;
  const parent = { id: "file", url: "https://example.test/parent.zip" };

  assert.equal(await resolveUrl(parent, {}, context), parent.url);
  assert.equal(await resolveUrl({ id: "file" }, {}, context), "");
  t.assert.snapshot(await resolveUrl(parent, {}, context));
});

test("production OGM filters restricted files without inheriting the caller's age claim", async () => {
  await seedFile();
  await driver.executeQuery(`
    MATCH (file:DownloadableFile {id: "file"}) SET file.ageGateRestricted = true
  `);
  assert.deepEqual(await findFileAccess(), []);
  const resolveUrl = createDownloadableFileUrlResolver(
    async () => { throw new Error("preloaded identity must be reused"); },
    async () => true
  );
  const context = {
    driver,
    jwt: { mayAccessSensitiveContent: true },
    user: {
      username: "uploader", email: null, email_verified: false, data: null,
    },
  } as GraphQLContext;
  assert.equal(
    await resolveUrl({ id: "file", url: "https://example.test/parent.zip" }, {}, context),
    ""
  );
});

test("production OGM filters a sensitive discussion out of the file access projection", async () => {
  await seedFile();
  await driver.executeQuery(`
    MATCH (discussion:Discussion {id: "discussion"})
    SET discussion.hasSensitiveContent = true
  `);
  const records = await findFileAccess();
  assert.equal(records[0]?.Discussion, null);
});

test("migrated URL decisions match production OGM for file and discussion visibility", async (t) => {
  await seedFile();
  for (const fileRestricted of [null, false, true]) {
    for (const discussionSensitive of [null, false, true]) {
      await driver.executeQuery(`
        MATCH (file:DownloadableFile {id: "file"})
        MATCH (discussion:Discussion {id: "discussion"})
        SET file.ageGateRestricted = $fileRestricted,
            discussion.hasSensitiveContent = $discussionSensitive
      `, { fileRestricted, discussionSensitive });
      for (const username of ["uploader", "author", "moderator", "stranger"]) {
        const canReview = username === "moderator";
        const resolveUrl = createDownloadableFileUrlResolver(
          async () => { throw new Error("identity is already available"); },
          async () => canReview
        );
        for (const url of [undefined, "https://example.test/parent.zip"]) {
          const parent = { id: "file", url };
          const context = {
            driver,
            // Old context-free OGM calls never inherited this claim.
            jwt: { mayAccessSensitiveContent: true },
            user: { username, email: null, email_verified: false, data: null },
          } as GraphQLContext;
          t.assert.snapshot(await resolveUrl(parent, {}, context));
        }
      }
    }
  }
});

test("missing files, absent relationships, and invalid selected values retain production outcomes", async () => {
  const repository = createDownloadableFileRepository(driver);
  assert.equal(await repository.findUrlAccess("missing"), null);
  await seedFile();
  await driver.executeQuery("MATCH (discussion:Discussion) DETACH DELETE discussion");
  assert.deepEqual(await repository.findUrlAccess("file"), {
    uploadedByUsername: "uploader", discussionAuthorUsername: null,
  });
  for (const [scanStatus, message] of [[null, /Cannot return null for non-nullable field DownloadableFile\.scanStatus/], ["INVALID", /cannot represent value/]] as const) {
    await driver.executeQuery(`
      MATCH (file:DownloadableFile {id: "file"}) SET file.scanStatus = $scanStatus
    `, { scanStatus });
    await assert.rejects(repository.findUrlAccess("file"), message);
  }
});

test("access lookup observes request writes through the shared bookmark manager", async () => {
  await runWithRequestBookmarks(async () => {
    await seedFile();
    const bookmarks = await getRequestBookmarkManager()?.getBookmarks();
    assert.ok(bookmarks && Array.from(bookmarks).length > 0);
    const repository = createDownloadableFileRepository(driver);
    assert.equal((await repository.findUrlAccess("file"))?.uploadedByUsername, "uploader");
    await driver.executeQuery(`
      MATCH (file:DownloadableFile {id: "file"}) SET file.ageGateRestricted = true
    `);
    assert.equal(await repository.findUrlAccess("file"), null);
  });
});

test("attachment metadata matches the production OGM projection and hidden-file outcome", async (t) => {
  await seedFile();
  const repository = createDownloadableFileRepository(driver);
  t.assert.snapshot(await repository.findAttachmentMetadata("missing"));
  for (const restricted of [null, false, true]) {
    for (const fileName of ["archive.zip", ""]) {
      await driver.executeQuery(`
        MATCH (file:DownloadableFile {id: "file"})
        SET file.ageGateRestricted = $restricted, file.fileName = $fileName,
            file.scanStatus = null
      `, { restricted, fileName });
      t.assert.snapshot(await repository.findAttachmentMetadata("file"));
      const context = {
        driver, jwt: { mayAccessSensitiveContent: true },
        contentFeaturePolicyRepository: {
          findChannelPolicy: async () => ({ found: true, allowedFileTypes: ["zip"] }),
          findServerFileTypePolicy: async () => ({ found: true, allowedFileTypes: ["zip"] }),
        },
      } as unknown as GraphQLContext;
      const input = {
        discussionInput: {
          DownloadableFiles: { connect: [{ where: { node: { id: "file" } } }] },
        },
        channelConnections: ["cats"],
      };
      t.assert.snapshot(await validateDiscussionDownloadPreferences(input, context));
    }
  }
  await driver.executeQuery(`
    MATCH (file:DownloadableFile {id: "file"})
    SET file.ageGateRestricted = false, file.fileName = null
  `);
  await assert.rejects(repository.findAttachmentMetadata("file"), /Cannot return null for non-nullable field DownloadableFile\.fileName/);
});

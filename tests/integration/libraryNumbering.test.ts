// Integration coverage for per-user library numbers (short URLs like
// /u/alice/images/12). Exercises the real create-path allocation, the
// (owner, number) constraints, the number->id lookup, and the backfill against
// a live Neo4j. Images first; albums and collections follow in later commits.
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createImageCreationRepository } from "../../services/persistence/imageWriteRepository.js";
import { backfillImageNumbers } from "../../services/imageNumberBackfill.js";
import { resolveIdByPerUserNumber, IMAGE_NUMBER } from "../../services/perUserNumber.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = await startNeo4j();
}, { timeout: 240000 });

beforeEach(async () => {
  await resetDatabase(driver);
});

after(async () => {
  await stopNeo4j();
});

const IMAGE_CONSTRAINT =
  "CREATE CONSTRAINT image_user_number_unique IF NOT EXISTS FOR (img:Image) REQUIRE (img.uploadedByUsername, img.imageNumber) IS UNIQUE";

const seedUsers = () =>
  driver.executeQuery(
    "CREATE (:User {username:'alice'}), (:User {username:'bob'})"
  );

const createImage = (username: string) =>
  createImageCreationRepository(driver).createImage({
    url: `https://example.test/${username}/${Math.random()}`,
    uploadedByUsername: username,
    Uploader: { connect: { where: { node: { username } } } },
  } as Parameters<ReturnType<typeof createImageCreationRepository>["createImage"]>[0]);

type Numbered = { id: string; number: number };

const imagesOf = async (username: string): Promise<Numbered[]> => {
  const result = await driver.executeQuery(
    "MATCH (img:Image {uploadedByUsername: $u}) RETURN img.id AS id, img.imageNumber AS number ORDER BY number",
    { u: username }
  );
  return result.records.map((r) => ({
    id: r.get("id") as string,
    number: (r.get("number") as { toNumber?: () => number })?.toNumber?.() ??
      (r.get("number") as number),
  }));
};

test("new images get sequential per-user numbers starting at 1", async () => {
  await seedUsers();
  await createImage("alice");
  await createImage("alice");
  await createImage("alice");
  assert.deepEqual((await imagesOf("alice")).map((e) => e.number), [1, 2, 3]);
});

test("image numbers are independent per user", async () => {
  await seedUsers();
  await createImage("alice");
  await createImage("bob");
  await createImage("alice");
  assert.deepEqual((await imagesOf("alice")).map((e) => e.number), [1, 2]);
  assert.deepEqual((await imagesOf("bob")).map((e) => e.number), [1]);
});

test("(uploadedByUsername, imageNumber) is unique", async () => {
  await seedUsers();
  await driver.executeQuery(IMAGE_CONSTRAINT);
  await createImage("alice");
  await assert.rejects(
    driver.executeQuery(
      "CREATE (:Image {id:'dup', uploadedByUsername:'alice', imageNumber:1})"
    ),
    /already exists|ConstraintValidationFailed|equivalent value/i
  );
});

test("getImageIdByNumber (resolveIdByPerUserNumber) maps a number back to its id", async () => {
  await seedUsers();
  await createImage("alice");
  await createImage("alice");
  const second = (await imagesOf("alice")).find((e) => e.number === 2);
  assert.ok(second);
  const session = driver.session();
  try {
    assert.equal(await resolveIdByPerUserNumber(session, IMAGE_NUMBER, "alice", 2), second.id);
    assert.equal(await resolveIdByPerUserNumber(session, IMAGE_NUMBER, "alice", 99), null);
  } finally {
    await session.close();
  }
});

test("backfill numbers legacy images (owner from edge) in creation order, idempotently", async () => {
  await seedUsers();
  // Legacy images: UPLOADED_IMAGE edge but no uploadedByUsername / imageNumber.
  await driver.executeQuery(
    "MATCH (u:User {username:'alice'}) " +
      "CREATE (u)-[:UPLOADED_IMAGE]->(:Image {id:'i1', createdAt: datetime('2021-01-01T00:00:00Z')}) " +
      "CREATE (u)-[:UPLOADED_IMAGE]->(:Image {id:'i2', createdAt: datetime('2021-02-01T00:00:00Z')})"
  );

  const result = await backfillImageNumbers(driver);
  assert.equal(result.nodesNumbered, 2);

  const byId = Object.fromEntries((await imagesOf("alice")).map((e) => [e.id, e.number]));
  assert.equal(byId["i1"], 1, "oldest image is #1");
  assert.equal(byId["i2"], 2);

  // Counter seeded: the next created image continues at 3.
  await createImage("alice");
  assert.ok(
    (await imagesOf("alice")).some((e) => e.number === 3),
    "next created image continues the sequence at 3"
  );

  const again = await backfillImageNumbers(driver);
  assert.equal(again.nodesNumbered, 0);
});

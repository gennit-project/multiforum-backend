// Integration coverage for per-user library numbers (short URLs like
// /u/alice/images/12). Exercises the real create-path allocation, the
// (owner, number) constraints, the number->id lookup, and the backfill against
// a live Neo4j. Images first; albums and collections follow in later commits.
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createImageCreationRepository } from "../../services/persistence/imageWriteRepository.js";
import { backfillImageNumbers } from "../../services/imageNumberBackfill.js";
import {
  backfillAlbumNumbers,
  backfillCollectionNumbers,
} from "../../services/albumCollectionNumberBackfill.js";
import {
  resolveIdByPerUserNumber,
  allocatePerUserNumberSnippet,
  IMAGE_NUMBER,
  ALBUM_NUMBER,
  COLLECTION_NUMBER,
} from "../../services/perUserNumber.js";
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

// --- Albums (owner = User HAS_ALBUM edge; HAS_ALBUM is reused by Discussion) ---

const numberedOf = async (
  label: string,
  username: string,
  field: string
): Promise<Numbered[]> => {
  const result = await driver.executeQuery(
    `MATCH (n:${label} {ownerUsername: $u}) RETURN n.id AS id, n.${field} AS number ORDER BY number`,
    { u: username }
  );
  return result.records.map((r) => ({
    id: r.get("id") as string,
    number: (r.get("number") as { toNumber?: () => number })?.toNumber?.() ??
      (r.get("number") as number),
  }));
};

test("album allocation snippet assigns sequential per-user numbers", async () => {
  await driver.executeQuery(
    "CREATE (:Album {id:'a1', ownerUsername:'alice'}), (:Album {id:'a2', ownerUsername:'alice'}), (:Album {id:'b1', ownerUsername:'bob'})"
  );
  for (const id of ["a1", "a2", "b1"]) {
    await driver.executeQuery(
      `MATCH (a:Album {id:$id})${allocatePerUserNumberSnippet("a", ALBUM_NUMBER)}`,
      { id }
    );
  }
  assert.deepEqual((await numberedOf("Album", "alice", "albumNumber")).map((e) => e.number), [1, 2]);
  assert.deepEqual((await numberedOf("Album", "bob", "albumNumber")).map((e) => e.number), [1]);
});

test("album backfill numbers User-owned albums and ignores discussion-only albums", async () => {
  await seedUsers();
  await driver.executeQuery(
    "MATCH (u:User {username:'alice'}) " +
      "CREATE (u)-[:HAS_ALBUM]->(:Album {id:'al1', createdAt: datetime('2021-01-01T00:00:00Z')}) " +
      "CREATE (u)-[:HAS_ALBUM]->(:Album {id:'al2', createdAt: datetime('2021-02-01T00:00:00Z')}) " +
      "CREATE (:Discussion {id:'d1'})-[:HAS_ALBUM]->(:Album {id:'al3', createdAt: datetime('2021-03-01T00:00:00Z')})"
  );
  const result = await backfillAlbumNumbers(driver);
  assert.equal(result.nodesNumbered, 2);
  const byId = Object.fromEntries(
    (await numberedOf("Album", "alice", "albumNumber")).map((e) => [e.id, e.number])
  );
  assert.equal(byId["al1"], 1);
  assert.equal(byId["al2"], 2);
  // Discussion-only album gets no owner / number.
  const al3 = await driver.executeQuery(
    "MATCH (a:Album {id:'al3'}) RETURN a.ownerUsername AS o, a.albumNumber AS n"
  );
  assert.equal(al3.records[0].get("o"), null);
  assert.equal(al3.records[0].get("n"), null);
  assert.equal((await backfillAlbumNumbers(driver)).nodesNumbered, 0);
});

test("album constraint + lookup", async () => {
  await driver.executeQuery(
    "CREATE CONSTRAINT album_user_number_unique IF NOT EXISTS FOR (a:Album) REQUIRE (a.ownerUsername, a.albumNumber) IS UNIQUE"
  );
  await driver.executeQuery("CREATE (:Album {id:'a1', ownerUsername:'alice', albumNumber:1})");
  await assert.rejects(
    driver.executeQuery("CREATE (:Album {id:'a2', ownerUsername:'alice', albumNumber:1})"),
    /already exists|ConstraintValidationFailed|equivalent value/i
  );
  const session = driver.session();
  try {
    assert.equal(await resolveIdByPerUserNumber(session, ALBUM_NUMBER, "alice", 1), "a1");
    assert.equal(await resolveIdByPerUserNumber(session, ALBUM_NUMBER, "alice", 2), null);
  } finally {
    await session.close();
  }
});

// --- Collections (owner = Collection CREATED_BY User edge) ---

test("collection allocation snippet assigns sequential per-user numbers", async () => {
  await driver.executeQuery(
    "CREATE (:Collection {id:'c1', name:'A', ownerUsername:'alice'}), (:Collection {id:'c2', name:'B', ownerUsername:'alice'})"
  );
  for (const id of ["c1", "c2"]) {
    await driver.executeQuery(
      `MATCH (c:Collection {id:$id})${allocatePerUserNumberSnippet("c", COLLECTION_NUMBER)}`,
      { id }
    );
  }
  assert.deepEqual(
    (await numberedOf("Collection", "alice", "collectionNumber")).map((e) => e.number),
    [1, 2]
  );
});

test("collection backfill derives owner from CREATED_BY and numbers in creation order", async () => {
  await seedUsers();
  await driver.executeQuery(
    "MATCH (u:User {username:'alice'}) " +
      "CREATE (c1:Collection {id:'co1', name:'One', createdAt: datetime('2021-01-01T00:00:00Z')})-[:CREATED_BY]->(u) " +
      "CREATE (c2:Collection {id:'co2', name:'Two', createdAt: datetime('2021-02-01T00:00:00Z')})-[:CREATED_BY]->(u)"
  );
  const result = await backfillCollectionNumbers(driver);
  assert.equal(result.nodesNumbered, 2);
  const byId = Object.fromEntries(
    (await numberedOf("Collection", "alice", "collectionNumber")).map((e) => [e.id, e.number])
  );
  assert.equal(byId["co1"], 1);
  assert.equal(byId["co2"], 2);

  const session = driver.session();
  try {
    assert.equal(await resolveIdByPerUserNumber(session, COLLECTION_NUMBER, "alice", 2), "co2");
  } finally {
    await session.close();
  }
  assert.equal((await backfillCollectionNumbers(driver)).nodesNumbered, 0);
});

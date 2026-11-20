import type { Driver } from "neo4j-driver";
import {
  backfillPerUserNumbers,
  ALBUM_NUMBER,
  COLLECTION_NUMBER,
} from "./perUserNumber.js";

/**
 * Backfills per-user album and collection numbers (/u/alice/albums/3,
 * /u/alice/collections/5). Albums and collections have no denormalized owner, so
 * first derive ownerUsername from the owner relationship (a User HAS_ALBUM for
 * albums — the same edge type is reused by Discussion, so match a User
 * specifically; CREATED_BY for collections), then number each owner's items in
 * creation order. Idempotent; must run before the (ownerUsername, number)
 * constraints are created.
 */
const ALBUM_OWNER = `
  MATCH (u:User)-[:HAS_ALBUM]->(a:Album)
  WHERE a.ownerUsername IS NULL
  SET a.ownerUsername = u.username
`;

const COLLECTION_OWNER = `
  MATCH (c:Collection)-[:CREATED_BY]->(u:User)
  WHERE c.ownerUsername IS NULL
  SET c.ownerUsername = u.username
`;

const denormalize = async (driver: Driver, query: string): Promise<void> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.executeWrite((tx) => tx.run(query));
  } finally {
    await session.close();
  }
};

export const backfillAlbumNumbers = async (driver: Driver) => {
  await denormalize(driver, ALBUM_OWNER);
  return backfillPerUserNumbers(driver, ALBUM_NUMBER);
};

export const backfillCollectionNumbers = async (driver: Driver) => {
  await denormalize(driver, COLLECTION_OWNER);
  return backfillPerUserNumbers(driver, COLLECTION_NUMBER);
};

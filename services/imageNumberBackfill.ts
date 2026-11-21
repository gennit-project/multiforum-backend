import type { Driver } from "neo4j-driver";
import { backfillPerUserNumbers, IMAGE_NUMBER } from "./perUserNumber.js";

/**
 * Backfills per-user image numbers (/u/alice/images/12). Legacy images may carry
 * an UPLOADED_IMAGE edge but no uploadedByUsername scalar, so first denormalize
 * the owner from the edge (only where missing), then number each owner's images
 * in creation order. Idempotent; must run before the
 * (uploadedByUsername, imageNumber) constraint is created.
 */
const DENORMALIZE_OWNER = `
  MATCH (u:User)-[:UPLOADED_IMAGE]->(img:Image)
  WHERE img.uploadedByUsername IS NULL
  SET img.uploadedByUsername = u.username
`;

export const backfillImageNumbers = async (
  driver: Driver
): Promise<{ ownersUpdated: number; nodesNumbered: number }> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    await session.executeWrite((tx) => tx.run(DENORMALIZE_OWNER));
  } finally {
    await session.close();
  }
  return backfillPerUserNumbers(driver, IMAGE_NUMBER);
};

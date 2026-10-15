import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";

export const executeManagedWrite = async <T>(
  driver: Driver,
  work: (transaction: ManagedTransaction) => Promise<T>
): Promise<T> => {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });

  try {
    return await session.executeWrite(work);
  } finally {
    await session.close();
  }
};

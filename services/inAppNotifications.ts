import neo4j, { type Driver } from "neo4j-driver";

const toNumber = (value: unknown): number =>
  neo4j.isInt(value) ? value.toNumber() : Number(value ?? 0);

export const createInAppNotificationsForUsers = async ({
  driver,
  usernames,
  notificationText,
  notificationType,
}: {
  driver: Driver;
  usernames: string[];
  notificationText: string;
  notificationType: string;
}): Promise<number> => {
  if (usernames.length === 0) return 0;

  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    // Keep this post-commit effect as one implicit transaction. Retrying a
    // random-UUID notification write requires a stable event key or outbox.
    const result = await session.run(
      `
      UNWIND $usernames AS username
      MATCH (user:User {username: username})
      CREATE (notification:Notification {
        id: randomUUID(),
        createdAt: datetime(),
        read: false,
        text: $notificationText,
        notificationType: $notificationType
      })
      CREATE (user)-[:HAS_NOTIFICATION]->(notification)
      RETURN count(notification) AS notificationsCreated
      `,
      { usernames, notificationText, notificationType }
    );

    return toNumber(result.records[0]?.get("notificationsCreated"));
  } finally {
    await session.close();
  }
};

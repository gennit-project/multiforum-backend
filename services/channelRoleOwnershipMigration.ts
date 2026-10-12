import type { Driver, Record as Neo4jRecord } from "neo4j-driver";

export type ChannelRoleKind = "ChannelRole" | "ModChannelRole";

export type ChannelRoleOwnershipRecord = {
  kind: ChannelRoleKind;
  elementId: string;
  id: string | null;
  name: string | null;
  storedChannelUniqueName: string | null;
  attachedChannelUniqueNames: string[];
  ownerChannelUniqueNames: string[];
  ownerRelationshipCount: number;
  matchingChannelCount: number;
  expectedChannelUniqueName: string | null;
};

export type ChannelRoleOwnershipReport = {
  records: ChannelRoleOwnershipRecord[];
  ambiguousAttachments: ChannelRoleOwnershipRecord[];
  missingChannels: ChannelRoleOwnershipRecord[];
  invalidOwners: ChannelRoleOwnershipRecord[];
  mismatchedIdentity: ChannelRoleOwnershipRecord[];
  missingIdentity: ChannelRoleOwnershipRecord[];
  duplicateIdentities: Array<{
    kind: ChannelRoleKind;
    channelUniqueName: string;
    name: string;
    elementIds: string[];
  }>;
  legacyGlobalNameConstraints: string[];
};

type Executor = {
  run: (
    query: string,
    params?: Record<string, unknown>
  ) => Promise<{ records: Neo4jRecord[] }>;
};

const roleDefinitions = [
  {
    kind: "ChannelRole" as const,
    ownerRelationship: "OWNS_CHANNEL_ROLE",
    attachmentRelationships: [
      "HAS_DEFAULT_CHANNEL_ROLE",
      "HAS_DEFAULT_ELEVATED_CHANNEL_ROLE",
      "HAS_DEFAULT_SUSPENDED_ROLE",
    ],
  },
  {
    kind: "ModChannelRole" as const,
    ownerRelationship: "OWNS_MOD_CHANNEL_ROLE",
    attachmentRelationships: [
      "HAS_DEFAULT_MOD_ROLE",
      "HAS_DEFAULT_ELEVATED_MOD_ROLE",
      "HAS_DEFAULT_SUSPENDED_ROLE",
    ],
  },
] as const;

const numberValue = (value: unknown) =>
  typeof (value as { toNumber?: () => number })?.toNumber === "function"
    ? (value as { toNumber: () => number }).toNumber()
    : Number(value ?? 0);

const inspectRoleKind = async (
  executor: Executor,
  definition: typeof roleDefinitions[number]
): Promise<ChannelRoleOwnershipRecord[]> => {
  const result = await executor.run(`
    MATCH (role:${definition.kind})
    OPTIONAL MATCH (attachedChannel:Channel)-[attachment]->(role)
    WHERE type(attachment) IN $attachmentRelationships
    WITH role,
         [name IN collect(DISTINCT attachedChannel.uniqueName) WHERE name IS NOT NULL] AS attachedChannelUniqueNames
    OPTIONAL MATCH (ownerChannel:Channel)-[owner:${definition.ownerRelationship}]->(role)
    WITH role,
         attachedChannelUniqueNames,
         [name IN collect(DISTINCT ownerChannel.uniqueName) WHERE name IS NOT NULL] AS ownerChannelUniqueNames,
         count(owner) AS ownerRelationshipCount
    OPTIONAL MATCH (matchingChannel:Channel {uniqueName: role.channelUniqueName})
    RETURN elementId(role) AS elementId,
           role.id AS id,
           role.name AS name,
           role.channelUniqueName AS storedChannelUniqueName,
           attachedChannelUniqueNames,
           ownerChannelUniqueNames,
           ownerRelationshipCount,
           count(matchingChannel) AS matchingChannelCount
    ORDER BY elementId
  `, { attachmentRelationships: [...definition.attachmentRelationships] });

  return result.records.map((record) => {
    const attachedChannelUniqueNames =
      (record.get("attachedChannelUniqueNames") as string[] | null) ?? [];
    const storedChannelUniqueName =
      (record.get("storedChannelUniqueName") as string | null) ?? null;
    const matchingChannelCount = numberValue(record.get("matchingChannelCount"));
    const expectedChannelUniqueName = attachedChannelUniqueNames.length === 1
      ? attachedChannelUniqueNames[0]
      : attachedChannelUniqueNames.length === 0 && matchingChannelCount === 1
        ? storedChannelUniqueName
        : null;
    return {
      kind: definition.kind,
      elementId: record.get("elementId") as string,
      id: (record.get("id") as string | null) ?? null,
      name: (record.get("name") as string | null) ?? null,
      storedChannelUniqueName,
      attachedChannelUniqueNames,
      ownerChannelUniqueNames:
        (record.get("ownerChannelUniqueNames") as string[] | null) ?? [],
      ownerRelationshipCount: numberValue(record.get("ownerRelationshipCount")),
      matchingChannelCount,
      expectedChannelUniqueName,
    };
  });
};

const findDuplicates = (records: ChannelRoleOwnershipRecord[]) => {
  const groups = new Map<string, ChannelRoleOwnershipRecord[]>();
  for (const record of records) {
    if (!record.expectedChannelUniqueName || !record.name) continue;
    const key = `${record.kind}\u0000${record.expectedChannelUniqueName}\u0000${record.name}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      kind: group[0].kind,
      channelUniqueName: group[0].expectedChannelUniqueName as string,
      name: group[0].name as string,
      elementIds: group.map((record) => record.elementId),
    }));
};

const inspect = async (executor: Executor): Promise<ChannelRoleOwnershipReport> => {
  const records: ChannelRoleOwnershipRecord[] = [];
  for (const definition of roleDefinitions) {
    records.push(...await inspectRoleKind(executor, definition));
  }
  const constraints = await executor.run(`
    SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties
    WHERE type IN ['UNIQUENESS', 'NODE_KEY']
      AND size(labelsOrTypes) = 1
      AND labelsOrTypes[0] IN ['ChannelRole', 'ModChannelRole']
      AND properties = ['name']
    RETURN name ORDER BY name
  `);
  return {
    records,
    ambiguousAttachments: records.filter(
      (record) => record.attachedChannelUniqueNames.length > 1
    ),
    missingChannels: records.filter(
      (record) =>
        record.expectedChannelUniqueName === null ||
        (record.attachedChannelUniqueNames.length === 0 && record.matchingChannelCount !== 1)
    ),
    invalidOwners: records.filter(
      (record) =>
        record.ownerRelationshipCount > 1 ||
        (record.ownerRelationshipCount === 1 &&
          record.ownerChannelUniqueNames[0] !== record.expectedChannelUniqueName)
    ),
    mismatchedIdentity: records.filter(
      (record) =>
        record.attachedChannelUniqueNames.length === 1 &&
        record.storedChannelUniqueName !== null &&
        record.storedChannelUniqueName !== record.attachedChannelUniqueNames[0]
    ),
    missingIdentity: records.filter(
      (record) => !record.name || !record.expectedChannelUniqueName
    ),
    duplicateIdentities: findDuplicates(records),
    legacyGlobalNameConstraints: constraints.records.map(
      (record) => record.get("name") as string
    ),
  };
};

export const auditChannelRoleOwnership = async (driver: Driver) => {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    return await inspect(session);
  } finally {
    await session.close();
  }
};

const assertSafeToMigrate = (report: ChannelRoleOwnershipReport) => {
  if (
    report.ambiguousAttachments.length ||
    report.missingChannels.length ||
    report.invalidOwners.length ||
    report.mismatchedIdentity.length ||
    report.missingIdentity.length ||
    report.duplicateIdentities.length
  ) {
    throw new Error(
      "Cannot backfill channel role ownership until ambiguous attachments, missing channels, invalid owners, identity mismatches, missing identity, and duplicate channel-scoped names are resolved."
    );
  }
};

const escapeConstraintName = (name: string) => name.replace(/`/g, "``");

export const migrateChannelRoleOwnership = async (driver: Driver) => {
  const report = await auditChannelRoleOwnership(driver);
  assertSafeToMigrate(report);

  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const linked = await session.executeWrite(async (transaction) => {
      const counts: Record<ChannelRoleKind, number> = {
        ChannelRole: 0,
        ModChannelRole: 0,
      };
      for (const definition of roleDefinitions) {
        const roles = report.records
          .filter((record) => record.kind === definition.kind)
          .map((record) => ({
            elementId: record.elementId,
            channelUniqueName: record.expectedChannelUniqueName,
          }));
        const result = await transaction.run(`
          UNWIND $roles AS item
          MATCH (role:${definition.kind})
          WHERE elementId(role) = item.elementId
          MATCH (channel:Channel {uniqueName: item.channelUniqueName})
          SET role.id = coalesce(role.id, randomUUID()),
              role.channelUniqueName = item.channelUniqueName
          MERGE (channel)-[:${definition.ownerRelationship}]->(role)
          RETURN count(role) AS linkedRoles
        `, { roles });
        counts[definition.kind] = numberValue(
          result.records[0]?.get("linkedRoles")
        );
      }
      return counts;
    });

    for (const constraintName of report.legacyGlobalNameConstraints) {
      await session.run(
        `DROP CONSTRAINT \`${escapeConstraintName(constraintName)}\` IF EXISTS`
      );
    }
    return {
      ...report,
      linkedChannelRoles: linked.ChannelRole,
      linkedModChannelRoles: linked.ModChannelRole,
      droppedLegacyConstraints: report.legacyGlobalNameConstraints.length,
    };
  } finally {
    await session.close();
  }
};

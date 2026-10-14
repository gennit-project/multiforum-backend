import neo4j, {
  type Driver,
  type ManagedTransaction,
  type Record as Neo4jRecord,
} from "neo4j-driver";

export type CriticalPropertyType =
  | "STRING"
  | "INTEGER"
  | "ZONED DATETIME";

export type CriticalPropertyDefinition = {
  label: string;
  property: string;
  type: CriticalPropertyType;
  reason: "identity" | "routing" | "cursor" | "counter";
};

const identity = (
  label: string,
  property: string,
  reason: CriticalPropertyDefinition["reason"] = "identity"
): CriticalPropertyDefinition => ({ label, property, type: "STRING", reason });

const createdAt = (label: string): CriticalPropertyDefinition => ({
  label,
  property: "createdAt",
  type: "ZONED DATETIME",
  reason: "cursor",
});

export const criticalPropertyDefinitions: readonly CriticalPropertyDefinition[] = [
  identity("User", "username"),
  identity("Channel", "uniqueName", "routing"),
  identity("Discussion", "id"),
  identity("Comment", "id"),
  identity("Event", "id"),
  identity("WikiPage", "id"),
  identity("WikiPage", "channelUniqueName", "routing"),
  identity("WikiPage", "slug", "routing"),
  identity("Issue", "id"),
  { label: "Issue", property: "issueNumber", type: "INTEGER", reason: "routing" },
  identity("DiscussionChannel", "id"),
  identity("DiscussionChannel", "discussionId", "routing"),
  identity("DiscussionChannel", "channelUniqueName", "routing"),
  identity("EventChannel", "id"),
  identity("EventChannel", "eventId", "routing"),
  identity("EventChannel", "channelUniqueName", "routing"),
  identity("Image", "id"),
  identity("DownloadableFile", "id"),
  identity("TextVersion", "id"),
  identity("ChannelIssueCounter", "channelUniqueName", "counter"),
  { label: "ChannelIssueCounter", property: "current", type: "INTEGER", reason: "counter" },
  identity("ServerIssueCounter", "scope", "counter"),
  { label: "ServerIssueCounter", property: "current", type: "INTEGER", reason: "counter" },
  ...[
    "Discussion",
    "Comment",
    "Event",
    "WikiPage",
    "Issue",
    "DiscussionChannel",
    "EventChannel",
    "Image",
    "DownloadableFile",
    "TextVersion",
  ].map(createdAt),
] as const;

const snakeCase = (value: string) =>
  value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

export const criticalPropertyConstraintNames = criticalPropertyDefinitions.flatMap(
  (definition) => {
    const prefix = `${snakeCase(definition.label)}_${snakeCase(definition.property)}`;
    return [`${prefix}_exists`, `${prefix}_type`];
  }
);

export const getCriticalPropertyConstraintStatements = () =>
  criticalPropertyDefinitions.flatMap((definition) => {
    const prefix = `${snakeCase(definition.label)}_${snakeCase(definition.property)}`;
    return [
      `CYPHER 25 CREATE CONSTRAINT ${prefix}_exists IF NOT EXISTS
        FOR (node:${definition.label}) REQUIRE node.${definition.property} IS NOT NULL`,
      `CYPHER 25 CREATE CONSTRAINT ${prefix}_type IF NOT EXISTS
        FOR (node:${definition.label}) REQUIRE node.${definition.property} IS :: ${definition.type}`,
    ];
  });

export type CriticalPropertyViolation = CriticalPropertyDefinition & {
  total: number;
  missing: number;
  wrongType: number;
  sampleElementIds: string[];
  repairableMissing: boolean;
};

export type CriticalPropertyAudit = {
  violations: CriticalPropertyViolation[];
  blockingViolations: CriticalPropertyViolation[];
  repairableViolations: CriticalPropertyViolation[];
};

const numberValue = (value: unknown): number =>
  neo4j.isInt(value) ? value.toNumber() : Number(value ?? 0);

const auditDefinition = async (
  transaction: ManagedTransaction,
  definition: CriticalPropertyDefinition
): Promise<CriticalPropertyViolation | null> => {
  const result = await transaction.run(`
    CYPHER 25
    MATCH (node:${definition.label})
    WITH node,
         node.${definition.property} IS NULL AS missing,
         node.${definition.property} IS NOT NULL
           AND NOT node.${definition.property} IS :: ${definition.type} AS wrongType
    RETURN count(node) AS total,
           sum(CASE WHEN missing THEN 1 ELSE 0 END) AS missing,
           sum(CASE WHEN wrongType THEN 1 ELSE 0 END) AS wrongType,
           collect(CASE WHEN missing OR wrongType THEN elementId(node) END)[..10]
             AS sampleElementIds
  `);
  const record = result.records[0] as Neo4jRecord | undefined;
  const missing = numberValue(record?.get("missing"));
  const wrongType = numberValue(record?.get("wrongType"));
  if (missing === 0 && wrongType === 0) return null;
  return {
    ...definition,
    total: numberValue(record?.get("total")),
    missing,
    wrongType,
    sampleElementIds: (record?.get("sampleElementIds") as string[] | null) ?? [],
    repairableMissing:
      definition.label === "Image" &&
      definition.property === "createdAt" &&
      missing > 0 &&
      wrongType === 0,
  };
};

export const auditCriticalProperties = async (
  driver: Driver
): Promise<CriticalPropertyAudit> => {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const violations = await session.executeRead(async (transaction) => {
      const results: CriticalPropertyViolation[] = [];
      for (const definition of criticalPropertyDefinitions) {
        const violation = await auditDefinition(transaction, definition);
        if (violation) results.push(violation);
      }
      return results;
    });
    return {
      violations,
      blockingViolations: violations.filter(
        (violation) => !violation.repairableMissing
      ),
      repairableViolations: violations.filter(
        (violation) => violation.repairableMissing
      ),
    };
  } finally {
    await session.close();
  }
};

export class CriticalPropertyDataError extends Error {
  constructor(public readonly audit: CriticalPropertyAudit) {
    super(
      "Critical property constraints require a clean data audit. Run pnpm migrate:critical-properties for details."
    );
    this.name = "CriticalPropertyDataError";
  }
}

const isEnterprise = (edition: string) =>
  edition.toLowerCase().includes("enterprise");

export const ensureCriticalPropertyConstraints = async (
  driver: Driver,
  edition: string
): Promise<{ skipped: boolean; constraints: string[] }> => {
  if (!isEnterprise(edition)) return { skipped: true, constraints: [] };

  const audit = await auditCriticalProperties(driver);
  if (audit.violations.length > 0) throw new CriticalPropertyDataError(audit);

  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    for (const statement of getCriticalPropertyConstraintStatements()) {
      // Schema operations are intentionally auto-commit and idempotent.
      await session.run(statement);
    }
    const result = await session.run(
      `CYPHER 25
       SHOW CONSTRAINTS YIELD name
       WHERE name IN $names
       RETURN name ORDER BY name`,
      { names: criticalPropertyConstraintNames }
    );
    const actual = result.records.map((record) => record.get("name") as string);
    const missing = criticalPropertyConstraintNames.filter(
      (name) => !actual.includes(name)
    );
    if (missing.length > 0) {
      throw new Error(`Critical property constraints were not created: ${missing.join(", ")}`);
    }
    return { skipped: false, constraints: actual };
  } finally {
    await session.close();
  }
};

export const migrateCriticalPropertyConstraints = async (
  driver: Driver,
  edition: string
) => {
  const before = await auditCriticalProperties(driver);
  if (before.blockingViolations.length > 0) {
    throw new CriticalPropertyDataError(before);
  }

  let repairedLegacyImageTimestamps = 0;
  if (before.repairableViolations.length > 0) {
    const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
    try {
      repairedLegacyImageTimestamps = await session.executeWrite(
        async (transaction) => {
          const result = await transaction.run(`
            CYPHER 25
            MATCH (image:Image)
            WHERE image.createdAt IS NULL
            SET image.createdAt = datetime({epochMillis: 0}),
                image.createdAtBackfillSource = 'legacy-unknown'
            RETURN count(image) AS repaired
          `);
          return numberValue(result.records[0]?.get("repaired"));
        }
      );
    } finally {
      await session.close();
    }
  }

  const after = await auditCriticalProperties(driver);
  if (after.violations.length > 0) throw new CriticalPropertyDataError(after);
  const provision = await ensureCriticalPropertyConstraints(driver, edition);
  return { before, after, repairedLegacyImageTimestamps, provision };
};

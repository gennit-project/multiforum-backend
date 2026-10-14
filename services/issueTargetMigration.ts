import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import {
  issueTargetDefinitions,
  type IssueTargetDefinition,
} from "./issueTargetIdentity.js";

export type IssueTargetMigrationRecord = {
  issueId: string;
  issueElementId: string;
  scalarField: string;
  relationshipType: string;
  scalarValue: string | null;
  relationshipValues: string[];
  relationshipCount: number;
  matchingTargetCount: number;
};

export type IssueTargetMigrationReport = {
  records: IssueTargetMigrationRecord[];
  missingRelationships: IssueTargetMigrationRecord[];
  missingTargets: IssueTargetMigrationRecord[];
  invalidRelationships: IssueTargetMigrationRecord[];
  ambiguousTargets: IssueTargetMigrationRecord[];
};

type Executor = {
  run: (
    query: string,
    params?: Record<string, unknown>
  ) => Promise<{ records: Neo4jRecord[] }>;
};

const numberValue = (value: unknown) =>
  typeof (value as { toNumber?: () => number })?.toNumber === "function"
    ? (value as { toNumber: () => number }).toNumber()
    : Number(value ?? 0);

const inspectDefinition = async (
  executor: Executor,
  definition: IssueTargetDefinition
): Promise<IssueTargetMigrationRecord[]> => {
  const result = await executor.run(`
    MATCH (issue:Issue)
    OPTIONAL MATCH (issue)-[relationship:${definition.relationshipType}]->(related:${definition.targetLabel})
    WITH issue,
         [value IN collect(DISTINCT related.${definition.targetKey}) WHERE value IS NOT NULL] AS relationshipValues,
         count(relationship) AS relationshipCount
    OPTIONAL MATCH (matchingTarget:${definition.targetLabel})
    WHERE matchingTarget.${definition.targetKey} = issue.${definition.scalarField}
    RETURN issue.id AS issueId,
           elementId(issue) AS issueElementId,
           issue.${definition.scalarField} AS scalarValue,
           relationshipValues,
           relationshipCount,
           count(matchingTarget) AS matchingTargetCount
    ORDER BY issueId
  `);
  return result.records.map((record) => ({
    issueId: record.get("issueId") as string,
    issueElementId: record.get("issueElementId") as string,
    scalarField: definition.scalarField,
    relationshipType: definition.relationshipType,
    scalarValue: (record.get("scalarValue") as string | null) ?? null,
    relationshipValues:
      (record.get("relationshipValues") as string[] | null) ?? [],
    relationshipCount: numberValue(record.get("relationshipCount")),
    matchingTargetCount: numberValue(record.get("matchingTargetCount")),
  }));
};

const inspect = async (executor: Executor): Promise<IssueTargetMigrationReport> => {
  const records: IssueTargetMigrationRecord[] = [];
  for (const definition of issueTargetDefinitions) {
    records.push(...await inspectDefinition(executor, definition));
  }
  return {
    records,
    missingRelationships: records.filter(
      (record) =>
        record.scalarValue !== null &&
        record.matchingTargetCount === 1 &&
        record.relationshipCount === 0
    ),
    missingTargets: records.filter(
      (record) =>
        record.scalarValue !== null &&
        record.matchingTargetCount === 0 &&
        record.relationshipCount === 0
    ),
    invalidRelationships: records.filter(
      (record) =>
        record.relationshipCount > 1 ||
        (record.relationshipCount === 1 &&
          (record.scalarValue === null ||
            record.relationshipValues[0] !== record.scalarValue))
    ),
    ambiguousTargets: records.filter(
      (record) => record.scalarValue !== null && record.matchingTargetCount > 1
    ),
  };
};

export const auditIssueTargets = async (driver: Driver) => {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    return await inspect(session);
  } finally {
    await session.close();
  }
};

export const migrateIssueTargets = async (driver: Driver) => {
  const report = await auditIssueTargets(driver);
  if (report.invalidRelationships.length || report.ambiguousTargets.length) {
    throw new Error(
      "Cannot backfill issue targets until mismatched, duplicate, and ambiguous relationships are resolved."
    );
  }

  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const linkedByRelationship = await session.executeWrite(async (transaction) => {
      const linked: Record<string, number> = {};
      for (const definition of issueTargetDefinitions) {
        const result = await transaction.run(`
          MATCH (issue:Issue)
          WHERE issue.${definition.scalarField} IS NOT NULL
          MATCH (target:${definition.targetLabel})
          WHERE target.${definition.targetKey} = issue.${definition.scalarField}
          MERGE (issue)-[:${definition.relationshipType}]->(target)
          RETURN count(issue) AS linkedIssues
        `);
        linked[definition.relationshipType] = numberValue(
          result.records[0]?.get("linkedIssues")
        );
      }
      return linked;
    });
    return { ...report, linkedByRelationship };
  } finally {
    await session.close();
  }
};

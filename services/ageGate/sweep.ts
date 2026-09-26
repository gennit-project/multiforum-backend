import type { Driver } from "neo4j-driver";
import {
  DERIVED_AGE_GATE_TYPES,
  type DerivedAgeGateType,
} from "./definitions.js";

/**
 * Brings each derived type's stored `ageGateCleared` flag in line with its
 * reference `ageGateSensitive` definition. Run manually (see
 * build_scripts/ageGateSweep.ts): as the backfill, before enabling the age
 * gate, and whenever a dry run reports mismatches.
 *
 * - toClear: not sensitive, but not yet cleared (new or never-evaluated
 *   nodes). Restricted viewers don't see these until cleared.
 * - toUnclear: cleared, but sensitive by definition. Restricted viewers can
 *   see these, so a non-zero count means a write path failed to un-clear.
 */
export type SweepTypeResult = {
  type: DerivedAgeGateType;
  toClear: number;
  toUnclear: number;
  unclearIds: string[];
  applied: number;
};

type SweepParams = {
  driver: Driver;
  statements: Record<DerivedAgeGateType, string>;
  apply: boolean;
  batchSize?: number;
  types?: readonly DerivedAgeGateType[];
};

const SAMPLE_IDS = 20;
const MAX_BATCHES_PER_TYPE = 10_000;

const mismatchQuery = (type: DerivedAgeGateType, statement: string) => `
  MATCH (this:\`${type}\`)
  CALL {
    WITH this
    ${statement}
  }
  WITH this, NOT ageGateSensitive AS shouldBeCleared
  WHERE coalesce(this.ageGateCleared, false) <> shouldBeCleared
`;

const toNumber = (value: unknown): number =>
  typeof value === "number"
    ? value
    : Number((value as { toNumber?: () => number })?.toNumber?.() ?? value);

async function countMismatches(
  driver: Driver,
  type: DerivedAgeGateType,
  statement: string
): Promise<Omit<SweepTypeResult, "applied">> {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(`
      ${mismatchQuery(type, statement)}
      RETURN
        sum(CASE WHEN shouldBeCleared THEN 1 ELSE 0 END) AS toClear,
        sum(CASE WHEN shouldBeCleared THEN 0 ELSE 1 END) AS toUnclear,
        [id IN collect(CASE WHEN shouldBeCleared THEN null ELSE this.id END)
          WHERE id IS NOT NULL][0..${SAMPLE_IDS}] AS unclearIds
    `);
    const record = result.records[0];
    return {
      type,
      toClear: toNumber(record?.get("toClear") ?? 0),
      toUnclear: toNumber(record?.get("toUnclear") ?? 0),
      unclearIds: (record?.get("unclearIds") as string[] | undefined) ?? [],
    };
  } finally {
    await session.close();
  }
}

async function applyMismatches(
  driver: Driver,
  type: DerivedAgeGateType,
  statement: string,
  batchSize: number
): Promise<number> {
  let applied = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_TYPE; batch += 1) {
    const session = driver.session();
    try {
      const result = await session.executeWrite((tx) =>
        tx.run(
          `
          ${mismatchQuery(type, statement)}
          WITH this, shouldBeCleared LIMIT toInteger($batchSize)
          SET this.ageGateCleared = shouldBeCleared
          RETURN count(this) AS updated
          `,
          { batchSize }
        )
      );
      const updated = toNumber(result.records[0]?.get("updated") ?? 0);
      applied += updated;
      if (updated < batchSize) return applied;
    } finally {
      await session.close();
    }
  }
  throw new Error(
    `${type}: still finding mismatches after ${MAX_BATCHES_PER_TYPE} batches`
  );
}

export async function sweepAgeGate({
  driver,
  statements,
  apply,
  batchSize = 500,
  types = DERIVED_AGE_GATE_TYPES,
}: SweepParams): Promise<SweepTypeResult[]> {
  const results: SweepTypeResult[] = [];
  for (const type of types) {
    const counts = await countMismatches(driver, type, statements[type]);
    const hasMismatches = counts.toClear + counts.toUnclear > 0;
    const applied =
      apply && hasMismatches
        ? await applyMismatches(driver, type, statements[type], batchSize)
        : 0;
    results.push({ ...counts, applied });
  }
  return results;
}

import type { Driver } from "neo4j-driver";
import {
  DERIVED_AGE_GATE_TYPES,
  type DerivedAgeGateType,
} from "./definitions.js";

/**
 * Brings each derived type's stored `ageGateRestricted` flag in line with its
 * reference `ageGateSensitive` definition. Content is clear unless marked, so
 * a missing flag means clear. Run manually (see build_scripts/ageGateSweep.ts):
 * as the backfill, before enabling the age gate, and whenever a dry run
 * reports mismatches.
 *
 * - toRestrict: under marked content, but not flagged. Restricted viewers can
 *   see these, so a non-zero count means a write path failed to mark them.
 * - toUnrestrict: flagged, but no longer under marked content. Over-marking
 *   only hides content from restricted viewers, so this is not a leak.
 */
export type SweepTypeResult = {
  type: DerivedAgeGateType;
  toRestrict: number;
  toUnrestrict: number;
  toRestrictIds: string[];
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
  WITH this, ageGateSensitive AS shouldBeRestricted
  WHERE coalesce(this.ageGateRestricted, false) <> shouldBeRestricted
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
        sum(CASE WHEN shouldBeRestricted THEN 1 ELSE 0 END) AS toRestrict,
        sum(CASE WHEN shouldBeRestricted THEN 0 ELSE 1 END) AS toUnrestrict,
        [id IN collect(CASE WHEN shouldBeRestricted THEN this.id ELSE null END)
          WHERE id IS NOT NULL][0..${SAMPLE_IDS}] AS toRestrictIds
    `);
    const record = result.records[0];
    return {
      type,
      toRestrict: toNumber(record?.get("toRestrict") ?? 0),
      toUnrestrict: toNumber(record?.get("toUnrestrict") ?? 0),
      toRestrictIds: (record?.get("toRestrictIds") as string[] | undefined) ?? [],
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
          WITH this, shouldBeRestricted LIMIT toInteger($batchSize)
          SET this.ageGateRestricted = shouldBeRestricted
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
    const hasMismatches = counts.toRestrict + counts.toUnrestrict > 0;
    const applied =
      apply && hasMismatches
        ? await applyMismatches(driver, type, statements[type], batchSize)
        : 0;
    results.push({ ...counts, applied });
  }
  return results;
}

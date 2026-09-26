import type { Driver, ManagedTransaction, Session, Transaction } from "neo4j-driver";
import {
  DERIVED_AGE_GATE_TYPES,
  type DerivedAgeGateType,
} from "./definitions.js";

/**
 * Keeps stored `ageGateRestricted` flags correct inside the same transaction
 * as the write that could change them (docs/age-gate-materialization-design.md).
 *
 * Every write transaction that goes through the driver runs this just before
 * it commits. It finds the nodes stamped (`ageGateTouchedAt`) by this
 * transaction, meaning created, or updated through a generated mutation or
 * the OGM, walks everything whose age-gate result can depend on them, and
 * re-evaluates those against the reference definitions. Because it runs in the
 * writing transaction, content is never committed without its flag.
 *
 * What this cannot see: relationship-only changes (connecting or moving an
 * existing node) don't stamp anything. Those are rejected by the write
 * validator unless a path handles them explicitly.
 */

/** Types whose stamp means "something beneath me may need re-evaluating". */
const TOUCHABLE_LABELS = ["Discussion", "Image", ...DERIVED_AGE_GATE_TYPES] as const;

/**
 * Links along which age-gate results inherit, oriented from the parent to the
 * content that depends on it (APOC relationship-filter syntax).
 */
const DEPENDENT_RELATIONSHIPS = [
  "<POSTED_IN_CHANNEL", // Discussion <- DiscussionChannel
  "CONTAINS_COMMENT>", // DiscussionChannel -> Comment
  "<IS_REPLY_TO", // Comment <- reply
  "<HAS_FEEDBACK_COMMENT", // Discussion/Comment <- feedback comment
  "HAS_TITLE_VERSION>", // Discussion -> TextVersion
  "HAS_BODY_VERSION>", // Discussion -> TextVersion
  "HAS_VERSION>", // Comment -> TextVersion, DownloadableFile -> FileVersion
  "HAS_DOWNLOADABLE_FILE>", // Discussion -> DownloadableFile
].join("|");

const WALK_LABELS = [
  "Discussion",
  "DiscussionChannel",
  "Comment",
  "TextVersion",
  "DownloadableFile",
  "FileVersion",
]
  .map((label) => `+${label}`)
  .join("|");

export function buildReconcileQuery(
  statements: Record<DerivedAgeGateType, string>
): string {
  const touched = TOUCHABLE_LABELS.map(
    (label) =>
      `MATCH (n:\`${label}\`) WHERE n.ageGateTouchedAt >= datetime.transaction() RETURN n`
  ).join("\n    UNION\n    ");

  const evaluate = DERIVED_AGE_GATE_TYPES.map(
    (type) => `WITH this
      WITH this WHERE this:\`${type}\`
      CALL {
        WITH this
        ${statements[type]}
      }
      RETURN ageGateSensitive`
  ).join("\n      UNION\n      ");

  return `
  CALL {
    ${touched}
  }
  WITH collect(n) AS touched
  WHERE size(touched) > 0
  CALL {
    WITH touched
    UNWIND touched AS start
    CALL apoc.path.subgraphNodes(start, {
      relationshipFilter: "${DEPENDENT_RELATIONSHIPS}",
      labelFilter: "${WALK_LABELS}"
    }) YIELD node
    RETURN collect(DISTINCT node) AS reached
  }
  WITH reached,
    [x IN reached WHERE x:Discussion | x.id] AS discussionIds,
    [x IN reached WHERE x:Comment | x.id] AS commentIds,
    [x IN reached WHERE x:Image | x.id] AS imageIds
  OPTIONAL MATCH (issue:Issue)
  WHERE issue.relatedDiscussionId IN discussionIds
     OR issue.relatedCommentId IN commentIds
     OR issue.relatedImageId IN imageIds
  WITH reached, collect(DISTINCT issue) AS issues
  WITH reached + issues AS candidates
  UNWIND candidates AS this
  WITH DISTINCT this
  CALL {
      ${evaluate}
  }
  WITH this, ageGateSensitive
  WHERE coalesce(this.ageGateRestricted, false) <> ageGateSensitive
  SET this.ageGateRestricted = ageGateSensitive
  RETURN count(this) AS updated
  `;
}

type TransactionLike = Pick<Transaction | ManagedTransaction, "run">;

const WRITE_METHODS = ["executeWrite", "writeTransaction"] as const;

/**
 * Wrap `driver.session()` so every write transaction reconciles age-gate
 * flags before it commits: managed transactions (`executeWrite`, the
 * deprecated `writeTransaction`, used by @neo4j/graphql and the OGM) and
 * explicit ones (`beginTransaction` ... `commit`). Auto-commit
 * `session.run` writes can't be extended this way; see the design doc.
 */
export function installAgeGateReconcile(
  driver: Driver,
  statements: Record<DerivedAgeGateType, string>
): Driver {
  const query = buildReconcileQuery(statements);
  const reconcile = (tx: TransactionLike) => tx.run(query);
  const originalSession = driver.session.bind(driver);

  driver.session = ((...args: Parameters<Driver["session"]>): Session => {
    const session = originalSession(...args);

    for (const method of WRITE_METHODS) {
      const original = (session as unknown as Record<string, unknown>)[method];
      if (typeof original !== "function") continue;
      (session as unknown as Record<string, unknown>)[method] = (
        work: (tx: ManagedTransaction) => unknown,
        ...rest: unknown[]
      ) =>
        (original as (...a: unknown[]) => unknown).call(
          session,
          async (tx: ManagedTransaction) => {
            const result = await work(tx);
            await reconcile(tx);
            return result;
          },
          ...rest
        );
    }

    // Read-only sessions can't write, so there is nothing to reconcile.
    const accessMode = (args[0] as { defaultAccessMode?: string } | undefined)
      ?.defaultAccessMode;
    if (accessMode === "READ") return session;

    const originalBegin = session.beginTransaction.bind(session);
    session.beginTransaction = ((...beginArgs: Parameters<Session["beginTransaction"]>) => {
      const tx = originalBegin(...beginArgs);
      const originalCommit = tx.commit.bind(tx);
      tx.commit = async () => {
        await reconcile(tx);
        return originalCommit();
      };
      return tx;
    }) as Session["beginTransaction"];

    return session;
  }) as Driver["session"];

  return driver;
}

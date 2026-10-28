import type { Driver } from "neo4j-driver";

/**
 * Connects the moderator who performed a moderation action to that action.
 *
 * FAMILY-3 / v7 spike prototype. @neo4j/graphql 7 generates no nested
 * `connect` (or `disconnect`) for to-one relationships — not on create, not on
 * update, and there is no top-level `*ConnectInput` for ModerationAction. So the
 * `PERFORMED_MODERATION_ACTION` edge, previously set via
 * `ModerationProfile: { connect: { where: { node: { displayName } } } }` inside
 * the generated mutation, must be created with a parameterized driver write.
 *
 * This mirrors the established pattern already in the codebase
 * (`permanentlyDeleteStoredUpload`): `OPTIONAL MATCH` the actor by its unique
 * key, then `FOREACH (… | MERGE …)` so a missing actor is skipped rather than
 * failing the whole write. Leader-routed via the driver default (see CLAUDE.md
 * Neo4j session-routing note) to preserve read-your-own-writes.
 *
 * The action id comes from the `createModerationActions`/nested-create response
 * (v7 does not allow setting `@id` on create input, so it is read back, not
 * supplied). A production rollout that also creates the embedded moderator
 * Comment and its Channel/Issue/CommentAuthor edges extends this same Cypher —
 * see V7_CODE_PATTERNS.md "Family 3".
 */
export async function connectModerationActor(
  driver: Driver,
  params: {
    actionId: string;
    modProfileName?: string | null;
    username?: string | null;
  }
): Promise<void> {
  await driver.executeQuery(
    `
    MATCH (action:ModerationAction { id: $actionId })
    WITH action
    OPTIONAL MATCH (mod:ModerationProfile { displayName: $modProfileName })
    FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END |
      MERGE (mod)-[:PERFORMED_MODERATION_ACTION]->(action)
    )
    WITH action
    OPTIONAL MATCH (actor:User { username: $username })
    FOREACH (_ IN CASE WHEN actor IS NULL THEN [] ELSE [1] END |
      MERGE (actor)-[:PERFORMED_MODERATION_ACTION]->(action)
    )
    `,
    {
      actionId: params.actionId,
      modProfileName: params.modProfileName ?? null,
      username: params.username ?? null,
    }
  );
}

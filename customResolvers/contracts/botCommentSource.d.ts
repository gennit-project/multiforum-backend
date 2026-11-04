/** The owned CREATE sets its identity. Other properties are caller-supplied or
 * converted driver values; relationship objects are not projected by this write. */
export type BotCommentCreatedSource = Record<string, unknown> & { id: string };
export type BotCommentRecord = { comment: { properties: Record<string, unknown> & { id: string } } };

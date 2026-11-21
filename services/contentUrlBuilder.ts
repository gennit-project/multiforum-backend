import type { Driver } from "neo4j-driver";
import { buildSlugSegment } from "./slugify.js";

/**
 * Builds the content URLs used in notification text and emails, in the short
 * "number + slug" / shortId scheme (e.g.
 * /forums/cats/discussions/42-trail-conditions/comments/4f3a9b2e1c7d).
 *
 * Each builder loads the per-forum number (DiscussionChannel/EventChannel),
 * title (for the slug), and comment shortId that the short URL needs, and falls
 * back to the raw id/uuid when a number or shortId is not present yet (e.g.
 * before the startup backfill runs). The fallback is byte-identical to the
 * pre-change URLs, so anything without a number keeps its old link.
 */

type Runner = {
  run: (
    cypher: string,
    params: Record<string, unknown>
  ) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
};

const toNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const n =
    (value as { toNumber?: () => number }).toNumber?.() ?? (value as number);
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
};

const str = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * Run a lookup, returning its first record or null on any failure. Building a
 * short URL is best-effort: a lookup error must never break the notification or
 * archive flow — the caller falls back to the raw id.
 */
const firstRecord = async (
  runner: Runner,
  cypher: string,
  params: Record<string, unknown>
): Promise<{ get: (key: string) => unknown } | null> => {
  try {
    const result = await runner.run(cypher, params);
    return result.records[0] ?? null;
  } catch {
    return null;
  }
};

const withSession = async <T>(
  driver: Driver,
  fn: (runner: Runner) => Promise<T>
): Promise<T> => {
  const session = driver.session();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
};

/** "{discussionNumber}-{slug}" for the channel, or the raw id as a fallback. */
export const discussionSegment = async (
  runner: Runner,
  channelUniqueName: string,
  discussionId: string
): Promise<string> => {
  const record = await firstRecord(
    runner,
    `OPTIONAL MATCH (d:Discussion {id: $discussionId})
     OPTIONAL MATCH (dc:DiscussionChannel {discussionId: $discussionId, channelUniqueName: $channelUniqueName})
     RETURN d.title AS title, dc.discussionNumber AS number`,
    { discussionId, channelUniqueName }
  );
  const number = toNumber(record?.get("number"));
  const title = str(record?.get("title"));
  return number != null ? buildSlugSegment(number, title) : discussionId;
};

/** "{eventNumber}-{slug}" for the channel, or the raw id as a fallback. */
export const eventSegment = async (
  runner: Runner,
  channelUniqueName: string,
  eventId: string
): Promise<string> => {
  const record = await firstRecord(
    runner,
    `OPTIONAL MATCH (e:Event {id: $eventId})
     OPTIONAL MATCH (ec:EventChannel {eventId: $eventId, channelUniqueName: $channelUniqueName})
     RETURN e.title AS title, ec.eventNumber AS number`,
    { eventId, channelUniqueName }
  );
  const number = toNumber(record?.get("number"));
  const title = str(record?.get("title"));
  return number != null ? buildSlugSegment(number, title) : eventId;
};

/** A comment's shortId, or the raw id as a fallback. */
export const commentSegment = async (
  runner: Runner,
  commentId: string
): Promise<string> => {
  const record = await firstRecord(
    runner,
    `MATCH (c:Comment {id: $commentId}) RETURN c.shortId AS shortId`,
    { commentId }
  );
  return str(record?.get("shortId")) ?? commentId;
};

export const buildDiscussionUrl = (
  driver: Driver,
  baseUrl: string,
  channelUniqueName: string,
  discussionId: string
): Promise<string> =>
  withSession(driver, async (runner) => {
    const segment = await discussionSegment(runner, channelUniqueName, discussionId);
    return `${baseUrl}/forums/${channelUniqueName}/discussions/${segment}`;
  });

export const buildDiscussionCommentUrl = (
  driver: Driver,
  baseUrl: string,
  channelUniqueName: string,
  discussionId: string,
  commentId: string
): Promise<string> =>
  withSession(driver, async (runner) => {
    const [discussion, comment] = await Promise.all([
      discussionSegment(runner, channelUniqueName, discussionId),
      commentSegment(runner, commentId),
    ]);
    return `${baseUrl}/forums/${channelUniqueName}/discussions/${discussion}/comments/${comment}`;
  });

export const buildEventUrl = (
  driver: Driver,
  baseUrl: string,
  channelUniqueName: string,
  eventId: string
): Promise<string> =>
  withSession(driver, async (runner) => {
    const segment = await eventSegment(runner, channelUniqueName, eventId);
    return `${baseUrl}/forums/${channelUniqueName}/events/${segment}`;
  });

export const buildEventCommentUrl = (
  driver: Driver,
  baseUrl: string,
  channelUniqueName: string,
  eventId: string,
  commentId: string
): Promise<string> =>
  withSession(driver, async (runner) => {
    const [event, comment] = await Promise.all([
      eventSegment(runner, channelUniqueName, eventId),
      commentSegment(runner, commentId),
    ]);
    return `${baseUrl}/forums/${channelUniqueName}/events/${event}/comments/${comment}`;
  });

/**
 * User-scoped image URL (/u/alice/images/12). Loads the per-user image number,
 * falling back to the raw id. Images are no longer linked under a forum path.
 */
export const buildImageUrl = (
  driver: Driver,
  baseUrl: string,
  ownerUsername: string,
  imageId: string
): Promise<string> =>
  withSession(driver, async (runner) => {
    const record = await firstRecord(
      runner,
      `MATCH (img:Image {id: $imageId}) RETURN img.imageNumber AS number`,
      { imageId }
    );
    const number = toNumber(record?.get("number"));
    return `${baseUrl}/u/${ownerUsername}/images/${number != null ? number : imageId}`;
  });

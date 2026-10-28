import neo4j, {type Driver} from 'neo4j-driver';
import type {Comment} from '../../ogm_types.js';

// FAMILY-3 / v7 (campaign #284). A bot reply connects an existing author
// (AUTHORED_COMMENT), channel (HAS_COMMENT), parent comment (IS_REPLY_TO),
// discussion channel (CONTAINS_COMMENT) and event (HAS_COMMENT) — all to-one
// relationships whose nested connect v7 removed — so it is owned Cypher. The
// caller still assembles the familiar create shape; the owned write reads the
// connected identifiers out of it.
export type CommentCreateLike = Record<string, unknown> & {
  CommentAuthor?: { User?: { connect?: { where?: { node?: { username?: string | null } | null } | null } | null } | null } | null;
  Channel?: { connect?: { where?: { node?: { uniqueName?: string | null } | null } | null } | null } | null;
  ParentComment?: { connect?: { where?: { node?: { id?: string | null } | null } | null } | null } | null;
  DiscussionChannel?: { connect?: { where?: { node?: { id?: string | null } | null } | null } | null } | null;
  Event?: { connect?: { where?: { node?: { id?: string | null } | null } | null } | null } | null;
};

export interface BotCommentRepository {createReply(input:CommentCreateLike):Promise<{comments:Comment[]}>;}

// Mirrors the generated projection the callers/tests read back.
const CREATE_REPLY = `
 CREATE (c:Comment)
 SET c += $scalars
 SET c.id = randomUUID(),
     c.createdAt = datetime(),
     c.ageGateTouchedAt = datetime(),
     c.isSticky = coalesce(c.isSticky, false)
 WITH c
 OPTIONAL MATCH (author:User {username: $authorUsername})
 FOREACH (_ IN CASE WHEN author IS NULL THEN [] ELSE [1] END | MERGE (author)-[:AUTHORED_COMMENT]->(c))
 WITH c
 OPTIONAL MATCH (ch:Channel {uniqueName: $channelUniqueName})
 FOREACH (_ IN CASE WHEN ch IS NULL THEN [] ELSE [1] END | MERGE (ch)-[:HAS_COMMENT]->(c))
 WITH c
 OPTIONAL MATCH (parent:Comment {id: $parentCommentId})
 FOREACH (_ IN CASE WHEN parent IS NULL THEN [] ELSE [1] END | MERGE (c)-[:IS_REPLY_TO]->(parent))
 WITH c
 OPTIONAL MATCH (dc:DiscussionChannel {id: $discussionChannelId})
 FOREACH (_ IN CASE WHEN dc IS NULL THEN [] ELSE [1] END | MERGE (dc)-[:CONTAINS_COMMENT]->(c))
 WITH c
 OPTIONAL MATCH (ev:Event {id: $eventId})
 FOREACH (_ IN CASE WHEN ev IS NULL THEN [] ELSE [1] END | MERGE (ev)-[:HAS_COMMENT]->(c))
 RETURN c AS comment
`;

const convertNeo4jValue = (value: unknown): unknown => {
  if (neo4j.isInt(value)) return (value as neo4j.Integer).toNumber();
  if (
    neo4j.isDateTime(value) || neo4j.isLocalDateTime(value) || neo4j.isDate(value) ||
    neo4j.isLocalTime(value) || neo4j.isTime(value) || neo4j.isDuration(value)
  ) return (value as {toString():string}).toString();
  return value;
};

export const createBotCommentRepository=(driver:Driver):BotCommentRepository=>({
  async createReply(input){
    const {CommentAuthor, Channel, ParentComment, DiscussionChannel, Event, ...rest} = input;
    const scalars = Object.fromEntries(Object.entries(rest).filter(([,v])=>v!==undefined));
    const result = await driver.executeQuery(CREATE_REPLY, {
      scalars,
      authorUsername: CommentAuthor?.User?.connect?.where?.node?.username ?? null,
      channelUniqueName: Channel?.connect?.where?.node?.uniqueName ?? null,
      parentCommentId: ParentComment?.connect?.where?.node?.id ?? null,
      discussionChannelId: DiscussionChannel?.connect?.where?.node?.id ?? null,
      eventId: Event?.connect?.where?.node?.id ?? null,
    });
    const record = result.records[0];
    if(!record) return {comments:[]};
    const props = (record.get('comment') as {properties:Record<string,unknown>}).properties;
    const comment: Record<string,unknown> = {};
    for(const [k,v] of Object.entries(props)){
      // ageGateTouchedAt is server-only (@selectable(onRead:false)).
      if(k==='ageGateTouchedAt') continue;
      comment[k]=convertNeo4jValue(v);
    }
    return {comments:[comment as unknown as Comment]};
  },
});

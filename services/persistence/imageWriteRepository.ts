import neo4j, { type Driver } from "neo4j-driver";
import type { Image, UserUpdateInput, ChannelUpdateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
export const CREATED_IMAGE_SELECTION = `
  {
    id
    url
    storageBucket
    storageObjectName
    storageUrl
    uploadedAt
    uploadedByUsername
    uploadedByIp
    alt
    caption
    longDescription
    copyright
    createdAt
    hasSensitiveContent
    hasSpoiler
    scanStatus
    Uploader {
      username
    }
    Albums {
      id
    }
  }
`;
export const PROFILE_IMAGE_SELECTION = `
  {
    username
    profilePicURL
    variantUrls
    avatar32Url
    avatar48Url
    avatar64Url
    avatar96Url
  }
`;
export const CHANNEL_ICON_SELECTION = `
  {
    uniqueName
    channelIconURL
    variantUrls
    icon32Url
    icon48Url
    icon64Url
    icon96Url
  }
`;

// FAMILY-3 / v7 (campaign #284). Image creation connects an existing Uploader
// (to-one, whose nested connect v7 removed) and existing Albums, so it is owned
// Cypher here. Profile/channel-icon writes are flat scalar updates on an existing
// node, so they stay on the generated API (reads are unaffected).
//
// The caller still assembles the familiar create shape ({ ...scalars, Uploader:
// { connect: { where: { node: { username } } } }, Albums: { connect: [...] } });
// the owned write reads the owner/album identifiers out of it rather than passing
// it to a generated mutation.
export type ImageCreateLike = Record<string, unknown> & {
  Uploader?: { connect?: { where?: { node?: { username?: string | null } | null } | null } | null } | null;
  Albums?: { connect?: Array<{ where?: { node?: { id?: string | null } | null } | null } | null> | null } | null;
};

export interface ImageCreationRepository {
  findUploader(username: string): Promise<Array<{username: string}>>;
  createImage(input: ImageCreateLike): Promise<{images: Image[]}>;
}
export interface ProfileImageRepository {setProfileImage(username: string, update: UserUpdateInput): Promise<{users: Array<Record<string, unknown>>}>;}
export interface ChannelIconRepository {setChannelIcon(uniqueName: string, update: ChannelUpdateInput): Promise<{channels: Array<Record<string, unknown>>}>;}
const UPLOADER = `query ImageUploader($where: UserWhere) {users(where: $where) {username}}`;
const PROFILE = `mutation SetUploadedProfileImage($where: UserWhere, $update: UserUpdateInput) {updateUsers(where: $where, update: $update) {users ${PROFILE_IMAGE_SELECTION}}}`;
const ICON = `mutation SetUploadedChannelIcon($where: ChannelWhere, $update: ChannelUpdateInput) {updateChannels(where: $where, update: $update) {channels ${CHANNEL_ICON_SELECTION}}}`;

// Owned image create: scalars + UPLOADED_IMAGE edge to the Uploader + HAS_IMAGE
// edges from any existing Albums, applying the @id/@timestamp/@default values the
// generated mutation used to supply. Best-effort to-one/to-many connects via the
// established OPTIONAL MATCH + FOREACH pattern.
const CREATE_IMAGE = `
 CREATE (img:Image)
 SET img += $scalars
 SET img.id = randomUUID(),
     img.createdAt = datetime(),
     img.ageGateTouchedAt = datetime(),
     img.uploadedAt = CASE WHEN $uploadedAt IS NULL THEN img.uploadedAt ELSE datetime($uploadedAt) END,
     img.scanStatus = coalesce(img.scanStatus, 'PENDING'),
     img.archived = coalesce(img.archived, false),
     img.permanentlyRemoved = coalesce(img.permanentlyRemoved, false)
 WITH img
 OPTIONAL MATCH (uploader:User {username: $uploaderUsername})
 FOREACH (_ IN CASE WHEN uploader IS NULL THEN [] ELSE [1] END |
  MERGE (uploader)-[:UPLOADED_IMAGE]->(img)
 )
 WITH img
 UNWIND (CASE WHEN size($albumIds) = 0 THEN [null] ELSE $albumIds END) AS albumId
 OPTIONAL MATCH (album:Album {id: albumId})
 FOREACH (_ IN CASE WHEN album IS NULL THEN [] ELSE [1] END |
  MERGE (album)-[:HAS_IMAGE]->(img)
 )
 WITH DISTINCT img
 OPTIONAL MATCH (u:User)-[:UPLOADED_IMAGE]->(img)
 OPTIONAL MATCH (img)<-[:HAS_IMAGE]-(a:Album)
 RETURN img AS image, u.username AS uploaderUsername, collect(DISTINCT a.id) AS albumIds
`;

const convertNeo4jValue = (value: unknown): unknown => {
  if (neo4j.isInt(value)) return (value as neo4j.Integer).toNumber();
  if (
    neo4j.isDateTime(value) ||
    neo4j.isLocalDateTime(value) ||
    neo4j.isDate(value) ||
    neo4j.isLocalTime(value) ||
    neo4j.isTime(value) ||
    neo4j.isDuration(value)
  ) {
    return (value as { toString(): string }).toString();
  }
  return value;
};

export function createImageCreationRepository(driver: Driver): ImageCreationRepository {
 return {
  async findUploader(username) {return (await executeGeneratedOperation<{users: Array<{username: string}>}>(driver,UPLOADER,{where:{username:{eq:username}}})).users;},
  async createImage(input) {
    const { Uploader, Albums, uploadedAt, ...rest } = input as ImageCreateLike & { uploadedAt?: unknown };
    const uploaderUsername = Uploader?.connect?.where?.node?.username ?? null;
    const albumIds = (Albums?.connect ?? [])
      .map((c) => c?.where?.node?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const scalars = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    const result = await driver.executeQuery(CREATE_IMAGE, {
      scalars,
      uploadedAt: uploadedAt ?? null,
      uploaderUsername,
      albumIds,
    });
    const record = result.records[0];
    if (!record) return { images: [] };
    const props = (record.get("image") as { properties: Record<string, unknown> }).properties;
    const image: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      // ageGateTouchedAt is server-only (@selectable(onRead: false)); the generated
      // projection excluded it, so keep it out of the returned shape too.
      if (key === "ageGateTouchedAt") continue;
      image[key] = convertNeo4jValue(value);
    }
    const connectedUploader = record.get("uploaderUsername") as string | null;
    image.Uploader = connectedUploader ? { username: connectedUploader } : null;
    image.Albums = ((record.get("albumIds") as Array<string | null>) ?? [])
      .filter((id): id is string => typeof id === "string")
      .map((id) => ({ id }));
    return { images: [image as unknown as Image] };
  },
 };
}
export function createProfileImageRepository(driver: Driver): ProfileImageRepository {
 return {async setProfileImage(username, update) {return (await executeGeneratedOperation<{updateUsers:{users:Array<Record<string,unknown>>}}>(driver,PROFILE,{where:{username:{eq:username}},update})).updateUsers;}};
}
export function createChannelIconRepository(driver: Driver): ChannelIconRepository {
 return {async setChannelIcon(uniqueName, update) {return (await executeGeneratedOperation<{updateChannels:{channels:Array<Record<string,unknown>>}}>(driver,ICON,{where:{uniqueName:{eq:uniqueName}},update})).updateChannels;}};
}

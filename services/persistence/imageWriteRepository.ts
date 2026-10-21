import type { Driver } from "neo4j-driver";
import type { Image, ImageCreateInput, UserUpdateInput, ChannelUpdateInput } from "../../ogm_types.js";
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
export interface ImageCreationRepository {
  findUploader(username: string): Promise<Array<{username: string}>>;
  createImage(input: ImageCreateInput): Promise<{images: Image[]}>;
}
export interface ProfileImageRepository {setProfileImage(username: string, update: UserUpdateInput): Promise<{users: Array<Record<string, unknown>>}>;}
export interface ChannelIconRepository {setChannelIcon(uniqueName: string, update: ChannelUpdateInput): Promise<{channels: Array<Record<string, unknown>>}>;}
const UPLOADER = `query ImageUploader($where: UserWhere) {users(where: $where) {username}}`;
const CREATE = `mutation CreateUploadedImage($input: [ImageCreateInput!]!) {createImages(input: $input) {images ${CREATED_IMAGE_SELECTION}}}`;
const PROFILE = `mutation SetUploadedProfileImage($where: UserWhere, $update: UserUpdateInput) {updateUsers(where: $where, update: $update) {users ${PROFILE_IMAGE_SELECTION}}}`;
const ICON = `mutation SetUploadedChannelIcon($where: ChannelWhere, $update: ChannelUpdateInput) {updateChannels(where: $where, update: $update) {channels ${CHANNEL_ICON_SELECTION}}}`;
export function createImageCreationRepository(driver: Driver): ImageCreationRepository {
 return {
  async findUploader(username) {return (await executeGeneratedOperation<{users: Array<{username: string}>}>(driver,UPLOADER,{where:{username}})).users;},
  async createImage(input) {return (await executeGeneratedOperation<{createImages:{images:Image[]}}>(driver,CREATE,{input:[input]})).createImages;},
 };
}
export function createProfileImageRepository(driver: Driver): ProfileImageRepository {
 return {async setProfileImage(username, update) {return (await executeGeneratedOperation<{updateUsers:{users:Array<Record<string,unknown>>}}>(driver,PROFILE,{where:{username},update})).updateUsers;}};
}
export function createChannelIconRepository(driver: Driver): ChannelIconRepository {
 return {async setChannelIcon(uniqueName, update) {return (await executeGeneratedOperation<{updateChannels:{channels:Array<Record<string,unknown>>}}>(driver,ICON,{where:{uniqueName},update})).updateChannels;}};
}
